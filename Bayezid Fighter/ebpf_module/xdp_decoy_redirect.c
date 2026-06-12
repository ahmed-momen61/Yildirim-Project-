#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 100000);
    __type(key, __u32);
    __type(value, __u32); // veth interface index of decoy container
} bayezid_redirect SEC(".maps");

SEC("xdp")
int xdp_redirect_func(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;
    
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return XDP_PASS;
    if (eth->h_proto != bpf_htons(ETH_P_IP)) return XDP_PASS;
    
    struct iphdr *iph = data + sizeof(*eth);
    if ((void *)(iph + 1) > data_end) return XDP_PASS;
    
    __u32 src_ip = iph->saddr;
    __u32 *target_ifindex = bpf_map_lookup_elem(&bayezid_redirect, &src_ip);
    
    if (target_ifindex) {
        return bpf_redirect(*target_ifindex, 0);
    }
    
    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
