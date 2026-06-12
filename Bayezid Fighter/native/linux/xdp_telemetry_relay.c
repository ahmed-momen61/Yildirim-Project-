#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <bpf/libbpf.h>
#include <bpf/bpf.h>
#include <zmq.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <sys/resource.h>

#define RINGBUF_MAP_PATH "/sys/fs/bpf/bayezid_telemetry_ringbuf"
#define BLOCKLIST_MAP_PATH "/sys/fs/bpf/bayezid_blocklist"

struct packet_event {
    __u32 src_ip;
    __u64 timestamp;
    __u8 action; 
};

void *zmq_pub_ctx;
void *zmq_pub_socket;

void *zmq_sub_ctx;
void *zmq_sub_socket;

int handle_event(void *ctx, void *data, size_t data_sz) {
    const struct packet_event *e = data;
    
    struct in_addr ip_addr;
    ip_addr.s_addr = e->src_ip;
    
    char json[256];
    snprintf(json, sizeof(json), 
             "{\"topic\":\"PACKET_EVENT\",\"ts\":%llu,\"src_ip\":\"%s\",\"action\":\"%s\",\"sensor\":\"xdp_striker\",\"os\":\"linux\"}",
             e->timestamp, inet_ntoa(ip_addr), e->action == 1 ? "DROP" : "PASS");
             
    zmq_send(zmq_pub_socket, "PACKET_EVENT", 12, ZMQ_SNDMORE);
    zmq_send(zmq_pub_socket, json, strlen(json), 0);
    
    return 0;
}

void *enforcement_thread(void *arg) {
    int blocklist_fd = bpf_obj_get(BLOCKLIST_MAP_PATH);
    if (blocklist_fd < 0) {
        fprintf(stderr, "Failed to open blocklist map for enforcement\n");
        return NULL;
    }

    while (1) {
        char topic[256];
        int size = zmq_recv(zmq_sub_socket, topic, 255, 0);
        if (size == -1) continue;
        topic[size] = '\0';

        char payload[1024];
        size = zmq_recv(zmq_sub_socket, payload, 1023, 0);
        if (size == -1) continue;
        payload[size] = '\0';

        if (strcmp(topic, "BLOCK_IP") == 0) {
            // Simplified JSON parsing: {"ip":"..."}
            char *ip_start = strstr(payload, "\"ip\":\"");
            if (ip_start) {
                ip_start += 6;
                char *ip_end = strchr(ip_start, '"');
                if (ip_end) {
                    *ip_end = '\0';
                    struct in_addr addr;
                    if (inet_pton(AF_INET, ip_start, &addr) == 1) {
                        __u32 ip = addr.s_addr;
                        __u32 val = 1;
                        bpf_map_update_elem(blocklist_fd, &ip, &val, BPF_ANY);
                        printf("[XDP RELAY] Enforced block on %s\n", ip_start);
                    }
                }
            }
        }
    }
    return NULL;
}

int main(int argc, char **argv) {
    zmq_pub_ctx = zmq_ctx_new();
    zmq_pub_socket = zmq_socket(zmq_pub_ctx, ZMQ_PUB);
    zmq_connect(zmq_pub_socket, "tcp://127.0.0.1:5555");
    
    zmq_sub_ctx = zmq_ctx_new();
    zmq_sub_socket = zmq_socket(zmq_sub_ctx, ZMQ_SUB);
    zmq_connect(zmq_sub_socket, "tcp://127.0.0.1:5556");
    zmq_setsockopt(zmq_sub_socket, ZMQ_SUBSCRIBE, "BLOCK_IP", 8);

    pthread_t thread_id;
    pthread_create(&thread_id, NULL, enforcement_thread, NULL);

    int ringbuf_fd = bpf_obj_get(RINGBUF_MAP_PATH);
    if (ringbuf_fd < 0) {
        fprintf(stderr, "Failed to open ringbuf. Make sure eBPF program is loaded.\n");
        sleep(5);
        return 1;
    }

    struct ring_buffer *rb = ring_buffer__new(ringbuf_fd, handle_event, NULL, NULL);
    if (!rb) {
        fprintf(stderr, "Failed to create ring buffer\n");
        return 1;
    }

    printf("[XDP RELAY] Starting telemetry relay...\n");
    while (1) {
        ring_buffer__poll(rb, 100);
    }

    return 0;
}
