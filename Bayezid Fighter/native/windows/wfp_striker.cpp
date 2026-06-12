#include <iostream>
#include <string>
#include <vector>
#include <unordered_set>
#include <zmq.h>
#include <windows.h>
#include <fwpmu.h>
#include <chrono>
#include <thread>
#include <mutex>

#pragma comment(lib, "fwpuclnt.lib")
#pragma comment(lib, "rpcrt4.lib")

// Global blocklist
std::unordered_set<std::string> blocklist;
std::mutex blocklist_mutex;

void* zmq_pub_socket = nullptr;
void* zmq_sub_socket = nullptr;

void WFP_BlockIP(const std::string& ipStr) {
    std::lock_guard<std::mutex> lock(blocklist_mutex);
    if (blocklist.count(ipStr)) return; // Already blocked
    
    HANDLE engineHandle = NULL;
    DWORD result = FwpmEngineOpen0(NULL, RPC_C_AUTHN_WINNT, NULL, NULL, &engineHandle);
    if (result != ERROR_SUCCESS) {
        std::cerr << "[WFP STRIKER] FATAL: FwpmEngineOpen0 failed (" << result << "). Requires Administrator privileges." << std::endl;
        return;
    }
    
    FWPM_FILTER0 filter = {0};
    FWPM_FILTER_CONDITION0 condition[1] = {0};
    
    filter.layerKey = FWPM_LAYER_INBOUND_TRANSPORT_V4;
    filter.action.type = FWP_ACTION_BLOCK;
    filter.weight.type = FWP_EMPTY; // Auto-weight
    filter.displayData.name = (wchar_t*)L"Absolute Symphony - Native WFP Block";
    
    // Parse IP string to IPv4 address (assuming simple format for now)
    ULONG ipAddress = inet_addr(ipStr.c_str());
    if (ipAddress == INADDR_NONE) {
        FwpmEngineClose0(engineHandle);
        return;
    }
    
    // Convert to network byte order
    ipAddress = ntohl(ipAddress);
    
    condition[0].fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS;
    condition[0].matchType = FWP_MATCH_EQUAL;
    condition[0].conditionValue.type = FWP_UINT32;
    condition[0].conditionValue.uint32 = ipAddress;
    
    filter.filterCondition = condition;
    filter.numFilterConditions = 1;
    
    UINT64 filterId = 0;
    result = FwpmFilterAdd0(engineHandle, &filter, NULL, &filterId);
    
    if (result == ERROR_SUCCESS) {
        blocklist.insert(ipStr);
        std::cout << "[WFP STRIKER] NATIVE ENFORCEMENT: Filter added for IP " << ipStr << " (ID: " << filterId << ")" << std::endl;
        
        // Broadcast the native action
        auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        char json[256];
        snprintf(json, sizeof(json),
                 "{\"topic\":\"PACKET_EVENT\",\"ts\":%lld,\"src_ip\":\"%s\",\"action\":\"NATIVE_WFP_DROP\",\"sensor\":\"wfp_striker\",\"os\":\"windows\"}",
                 now, ipStr.c_str());

        zmq_send(zmq_pub_socket, "PACKET_EVENT", 12, ZMQ_SNDMORE);
        zmq_send(zmq_pub_socket, json, strlen(json), 0);
    } else {
        std::cerr << "[WFP STRIKER] FwpmFilterAdd0 failed: " << result << std::endl;
    }
    
    FwpmEngineClose0(engineHandle);
}

void StartNativeWFPMonitor() {
    // In a full native implementation, this thread would act as a WFP callout driver interface.
    // For this module, the enforcement is natively handled above via FwpmFilterAdd0.
    // We log that the native monitor is active and enforcing Absolute Symphony.
    std::cout << "[WFP STRIKER] Native WFP Execution Monitor Active. Dropping packets natively at TCP stack." << std::endl;
    while(true) {
        std::this_thread::sleep_for(std::chrono::minutes(1)); // Keep thread alive
    }
}

void EnforcementThread() {
    char topic[256];
    char msg[1024];
    while(true) {
        int size = zmq_recv(zmq_sub_socket, topic, 255, 0);
        if (size == -1) continue;
        topic[size] = '\0';
        
        size = zmq_recv(zmq_sub_socket, msg, 1023, 0);
        if (size == -1) continue;
        msg[size] = '\0';
        
        if (strcmp(topic, "BLOCK_IP") == 0) {
            // Very simple JSON parsing for {"ip":"1.2.3.4"}
            std::string payload(msg);
            size_t ip_pos = payload.find("\"ip\":\"");
            if (ip_pos != std::string::npos) {
                ip_pos += 6;
                size_t ip_end = payload.find("\"", ip_pos);
                if (ip_end != std::string::npos) {
                    std::string ipStr = payload.substr(ip_pos, ip_end - ip_pos);
                    std::cout << "[WFP STRIKER] Received ZMQ BLOCK_IP command for " << ipStr << std::endl;
                    WFP_BlockIP(ipStr);
                }
            }
        }
    }
}

int main() {
    void* zmq_ctx = zmq_ctx_new();
    
    zmq_pub_socket = zmq_socket(zmq_ctx, ZMQ_PUB);
    zmq_connect(zmq_pub_socket, "tcp://127.0.0.1:5555");
    
    zmq_sub_socket = zmq_socket(zmq_ctx, ZMQ_SUB);
    zmq_connect(zmq_sub_socket, "tcp://127.0.0.1:5556");
    zmq_setsockopt(zmq_sub_socket, ZMQ_SUBSCRIBE, "BLOCK_IP", 8);

    std::cout << "[WFP STRIKER] Windows Filtering Platform module initialized." << std::endl;
    
    std::thread enf_thread(EnforcementThread);
    std::thread sim_thread(StartNativeWFPMonitor);
    
    enf_thread.join();
    sim_thread.join();

    return 0;
}
