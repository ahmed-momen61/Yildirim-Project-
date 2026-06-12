#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <bpf/libbpf.h>
#include <bpf/bpf.h>
#include <zmq.h>
#include <sys/resource.h>

#define MNEMON_RINGBUF_PATH "/sys/fs/bpf/bayezid_mnemon_events"

struct mnemon_event {
    __u32 pid;
    __u32 uid;
    __u32 syscall_nr;
    __u64 timestamp;
    __u64 arg0;
    __u64 arg1;
    __u64 arg2;
    char comm[16];
    __u8 action; 
};

void *zmq_pub_ctx;
void *zmq_pub_socket;

const char* get_syscall_name(__u32 nr) {
    switch(nr) {
        case 9: return "mmap";
        case 10: return "mprotect";
        case 59: return "execve";
        case 101: return "ptrace";
        case 311: return "process_vm_writev";
        case 319: return "memfd_create";
        default: return "unknown";
    }
}

int handle_syscall_event(void *ctx, void *data, size_t data_sz) {
    const struct mnemon_event *e = data;
    
    char json[512];
    snprintf(json, sizeof(json), 
             "{\"topic\":\"SYSCALL_EVENT\",\"ts\":%llu,\"pid\":%u,\"uid\":%u,\"syscall\":\"%s\",\"process\":\"%s\",\"action\":\"%s\",\"sensor\":\"syscall_relay\",\"os\":\"linux\"}",
             e->timestamp, e->pid, e->uid, get_syscall_name(e->syscall_nr), e->comm, e->action == 1 ? "KILLED" : "LOGGED");
             
    zmq_send(zmq_pub_socket, "SYSCALL_EVENT", 13, ZMQ_SNDMORE);
    zmq_send(zmq_pub_socket, json, strlen(json), 0);
    
    return 0;
}

int main(int argc, char **argv) {
    zmq_pub_ctx = zmq_ctx_new();
    zmq_pub_socket = zmq_socket(zmq_pub_ctx, ZMQ_PUB);
    zmq_connect(zmq_pub_socket, "tcp://127.0.0.1:5555");
    
    int ringbuf_fd = bpf_obj_get(MNEMON_RINGBUF_PATH);
    if (ringbuf_fd < 0) {
        fprintf(stderr, "[SYSCALL RELAY] Failed to open mnemon ringbuf. EBPF probes must be loaded first.\n");
        sleep(5);
        return 1;
    }

    struct ring_buffer *rb = ring_buffer__new(ringbuf_fd, handle_syscall_event, NULL, NULL);
    if (!rb) {
        fprintf(stderr, "Failed to create ring buffer\n");
        return 1;
    }

    printf("[SYSCALL RELAY] Starting tracepoint relay...\n");
    while (1) {
        ring_buffer__poll(rb, 100);
    }

    return 0;
}
