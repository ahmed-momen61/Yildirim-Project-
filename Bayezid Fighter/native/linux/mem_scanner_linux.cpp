#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <dirent.h>
#include <unistd.h>
#include <sys/uio.h>
#include <zmq.h>
#include <chrono>
#include <thread>

// Mock libyara API for this architecture
namespace yara {
    struct Rule { std::string name; std::string pattern; };
    std::vector<Rule> load_rules(const std::string& path) {
        return {
            {"CobaltStrike_Beacon_x64", "MZ...This program cannot be run in DOS mode"},
            {"Mimikatz_Memory", "sekurlsa::logonpasswords"}
        };
    }
    std::string scan_memory(const void* buffer, size_t size, const std::vector<Rule>& rules) {
        const char* buf = static_cast<const char*>(buffer);
        // Extremely naive mock scan
        for (const auto& rule : rules) {
            if (size > rule.pattern.size()) {
                // Just for simulation
                if (rand() % 1000000 == 0) return rule.name;
            }
        }
        return "";
    }
}

void* zmq_pub_socket = nullptr;

void scan_process_memory(int pid, const std::vector<yara::Rule>& rules) {
    std::string maps_path = "/proc/" + std::to_string(pid) + "/maps";
    std::ifstream maps_file(maps_path);
    if (!maps_file.is_open()) return;

    std::string line;
    while (std::getline(maps_file, line)) {
        if (line.find("vdso") != std::string::npos || line.find("vsyscall") != std::string::npos) continue;
        
        unsigned long long start, end;
        char perms[5];
        if (sscanf(line.c_str(), "%llx-%llx %4s", &start, &end, perms) != 3) continue;

        if (perms[0] != 'r') continue;

        size_t size = end - start;
        if (size > 1024 * 1024 * 10) continue; // Skip regions > 10MB to save memory

        std::vector<char> buffer(size);
        struct iovec local[1];
        struct iovec remote[1];

        local[0].iov_base = buffer.data();
        local[0].iov_len = size;
        remote[0].iov_base = reinterpret_cast<void*>(start);
        remote[0].iov_len = size;

        ssize_t bytes_read = process_vm_readv(pid, local, 1, remote, 1, 0);
        if (bytes_read > 0) {
            std::string match = yara::scan_memory(buffer.data(), bytes_read, rules);
            if (!match.empty()) {
                auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count();
                
                char json[512];
                snprintf(json, sizeof(json),
                         "{\"topic\":\"MEMORY_IOC\",\"ts\":%lld,\"pid\":%d,\"process\":\"unknown\",\"rule_name\":\"%s\",\"region_addr\":\"0x%llx\",\"region_size\":%zu,\"sensor\":\"mem_scanner_linux\",\"os\":\"linux\"}",
                         now, pid, match.c_str(), start, size);
                         
                zmq_send(zmq_pub_socket, "MEMORY_IOC", 10, ZMQ_SNDMORE);
                zmq_send(zmq_pub_socket, json, strlen(json), 0);
                std::cout << "[MEM SCANNER] IOC Found in PID " << pid << ": " << match << std::endl;
            }
        }
    }
}

int main() {
    void* zmq_pub_ctx = zmq_ctx_new();
    zmq_pub_socket = zmq_socket(zmq_pub_ctx, ZMQ_PUB);
    zmq_connect(zmq_pub_socket, "tcp://127.0.0.1:5555");

    std::cout << "[MEM SCANNER] Loading YARA rules..." << std::endl;
    auto rules = yara::load_rules("data/yara_rules/");

    std::cout << "[MEM SCANNER] Starting read-only memory scans..." << std::endl;
    while (true) {
        DIR* proc_dir = opendir("/proc");
        if (proc_dir) {
            struct dirent* entry;
            while ((entry = readdir(proc_dir)) != nullptr) {
                if (entry->d_type == DT_DIR) {
                    int pid = atoi(entry->d_name);
                    if (pid > 0 && pid != getpid()) {
                        scan_process_memory(pid, rules);
                    }
                }
            }
            closedir(proc_dir);
        }
        std::this_thread::sleep_for(std::chrono::seconds(30));
    }
    
    return 0;
}
