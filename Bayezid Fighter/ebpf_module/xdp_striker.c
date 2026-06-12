#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 100000);
    __type(key, __u32);
    __type(value, __u32);
} blocklist SEC(".maps");

struct packet_event {
    __u32 src_ip;
    __u64 timestamp;
    __u8 action; // 1 = DROP, 0 = PASS
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} telemetry_ringbuf SEC(".maps");

SEC("xdp")
int xdp_drop_func(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;
    
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return XDP_PASS;
    if (eth->h_proto != bpf_htons(ETH_P_IP)) return XDP_PASS;
    
    struct iphdr *iph = data + sizeof(*eth);
    if ((void *)(iph + 1) > data_end) return XDP_PASS;
    
    __u32 src_ip = iph->saddr;
    __u32 *is_blocked = bpf_map_lookup_elem(&blocklist, &src_ip);
    
    if (is_blocked && *is_blocked == 1) {
        struct packet_event *evt;
        evt = bpf_ringbuf_reserve(&telemetry_ringbuf, sizeof(*evt), 0);
        if (evt) {
            evt->src_ip = src_ip;
            evt->timestamp = bpf_ktime_get_ns();
            evt->action = 1;
            bpf_ringbuf_submit(evt, 0);
        }
        return XDP_DROP;
    }
    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";