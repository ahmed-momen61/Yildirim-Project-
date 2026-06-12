#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <linux/in.h>
#define MAX_FEATURES 8
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key, __u32); 
    __type(value, __s64); 
    __uint(max_entries, 10);
    __uint(pinning, LIBBPF_PIN_BY_NAME);
} bayezid_neural_weights SEC(".maps");
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __type(key, __u32);
    __type(value, __u32);
    __uint(max_entries, 100000);
    __uint(pinning, LIBBPF_PIN_BY_NAME);
} bayezid_blocklist SEC(".maps");
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __type(key, __u32);
    __type(value, __u32);
    __uint(max_entries, 1);
    __uint(pinning, LIBBPF_PIN_BY_NAME);
} bayezid_ebpf_mode SEC(".maps");
#define FP_SCALE 1000000 
static __always_inline __s64 fixed_point_multiply(__s64 a, __s64 b) {
    return (a * b) / FP_SCALE;
}
static __always_inline __s64 apply_activation_function(__s64 logit) {
    if (logit < -2 * FP_SCALE) return 0;
    if (logit > 2 * FP_SCALE) return FP_SCALE;
    return (logit / 4) + (FP_SCALE / 2);
}
SEC("xdp_drop")
int xdp_striker(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;
    if (eth->h_proto != bpf_htons(ETH_P_IP))
        return XDP_PASS;
    struct iphdr *iph = (struct iphdr *)(eth + 1);
    if ((void *)(iph + 1) > data_end)
        return XDP_PASS;
    __u32 src_ip = iph->saddr;
    __u32 mode_key = 0;
    __u32 *monitor_mode = bpf_map_lookup_elem(&bayezid_ebpf_mode, &mode_key);
    int is_monitor_only = (monitor_mode && *monitor_mode == 1);
    __u32 *is_blocked = bpf_map_lookup_elem(&bayezid_blocklist, &src_ip);
    if (is_blocked && *is_blocked == 1) {
        if (is_monitor_only) {
            bpf_printk("MONITOR: Would drop blocklisted IP\n");
            return XDP_PASS;
        }
        return XDP_DROP; 
    }
    if (iph->protocol == IPPROTO_TCP) {
        struct tcphdr *tcph = (struct tcphdr *)(iph + 1);
        if ((void *)(tcph + 1) > data_end)
            return XDP_PASS;
        __s64 features[MAX_FEATURES] = {0};
        features[0] = (__s64)(iph->tot_len) * FP_SCALE;            
        features[1] = (__s64)(iph->ttl) * FP_SCALE;                
        features[2] = (__s64)(tcph->window) * FP_SCALE;            
        features[3] = (__s64)(tcph->syn ? 1 : 0) * FP_SCALE;       
        features[4] = (__s64)(tcph->ack ? 1 : 0) * FP_SCALE;       
        features[5] = (__s64)(tcph->psh ? 1 : 0) * FP_SCALE;       
        features[6] = (__s64)(bpf_ntohs(tcph->dest)) * FP_SCALE;   
        features[7] = 0; 
        __u32 model_id = 1; 
        __s64 *weights_raw = bpf_map_lookup_elem(&bayezid_neural_weights, &model_id);
        if (weights_raw) {
            __s64 logit = 0;
            logit += fixed_point_multiply(features[0], weights_raw[0]);
            logit += fixed_point_multiply(features[1], weights_raw[1]);
            logit += fixed_point_multiply(features[2], weights_raw[2]);
            logit += fixed_point_multiply(features[3], weights_raw[3]);
            logit += fixed_point_multiply(features[4], weights_raw[4]);
            logit += fixed_point_multiply(features[5], weights_raw[5]);
            logit += fixed_point_multiply(features[6], weights_raw[6]);
            logit += weights_raw[8]; 
            __s64 prediction_confidence = apply_activation_function(logit);
            if (prediction_confidence > 850000) { 
                if (is_monitor_only) {
                    bpf_printk("MONITOR: NEE confidence > 85%%, would drop\n");
                    return XDP_PASS;
                }
                return XDP_DROP;
            }
        }
    }
    return XDP_PASS;
}
char _license[] SEC("license") = "GPL";
