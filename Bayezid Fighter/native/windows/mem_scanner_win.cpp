#include <iostream>
#include <string>
#include <vector>
#include <windows.h>
#include <psapi.h>
#include <zmq.h>
#include <chrono>
#include <thread>

// Mock libyara API
namespace yara {
    struct Rule { std::string name; std::string pattern; };
    std::vector<Rule> load_rules(const std::string& path) {
        return {
            {"CobaltStrike_Beacon_x64", "MZ...This program cannot be run in DOS mode"},
            {"Mimikatz_Memory", "sekurlsa::logonpasswords"}
        };
    }
    std::string scan_memory(const void* buffer, size_t size, const std::vector<Rule>& rules) {
        if (size == 0) return "";
        const char* buf = static_cast<const char*>(buffer);
        for (const auto& rule : rules) {
            if (size >= rule.pattern.size()) {
                // Real byte-level pattern matching instead of simulation
                const char* end = buf + size - rule.pattern.size();
                for (const char* ptr = buf; ptr <= end; ++ptr) {
                    if (memcmp(ptr, rule.pattern.data(), rule.pattern.size()) == 0) {
                        return rule.name;
                    }
                }
            }
        }
        return "";
    }
}

void* zmq_pub_socket = nullptr;

void ScanProcessMemory(DWORD processID, const std::vector<yara::Rule>& rules) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, processID);
    if (hProcess == NULL) return;
    
    // Get process name
    TCHAR szProcessName[MAX_PATH] = TEXT("<unknown>");
    HMODULE hMod;
    DWORD cbNeeded;
    if (EnumProcessModules(hProcess, &hMod, sizeof(hMod), &cbNeeded)) {
        GetModuleBaseName(hProcess, hMod, szProcessName, sizeof(szProcessName)/sizeof(TCHAR));
    }
    
    SYSTEM_INFO sysInfo;
    GetSystemInfo(&sysInfo);
    
    unsigned char* pAddress = (unsigned char*)sysInfo.lpMinimumApplicationAddress;
    MEMORY_BASIC_INFORMATION memInfo;
    
    while (pAddress < sysInfo.lpMaximumApplicationAddress) {
        if (VirtualQueryEx(hProcess, pAddress, &memInfo, sizeof(memInfo)) == sizeof(memInfo)) {
            // Only scan committed and readable memory
            if (memInfo.State == MEM_COMMIT && 
                (memInfo.Protect == PAGE_READONLY || 
                 memInfo.Protect == PAGE_READWRITE || 
                 memInfo.Protect == PAGE_EXECUTE_READ || 
                 memInfo.Protect == PAGE_EXECUTE_READWRITE)) {
                     
                size_t size = memInfo.RegionSize;
                if (size <= 1024 * 1024 * 10) { // Limit to 10MB chunks
                    std::vector<char> buffer(size);
                    SIZE_T bytesRead;
                    if (ReadProcessMemory(hProcess, pAddress, buffer.data(), size, &bytesRead)) {
                        std::string match = yara::scan_memory(buffer.data(), bytesRead, rules);
                        if (!match.empty()) {
                            auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::system_clock::now().time_since_epoch()).count();
                            
                            char json[512];
                            snprintf(json, sizeof(json),
                                     "{\"topic\":\"MEMORY_IOC\",\"ts\":%lld,\"pid\":%lu,\"process\":\"%s\",\"rule_name\":\"%s\",\"region_addr\":\"0x%llx\",\"region_size\":%zu,\"sensor\":\"mem_scanner_win\",\"os\":\"windows\"}",
                                     now, processID, szProcessName, match.c_str(), (unsigned long long)pAddress, size);
                                     
                            zmq_send(zmq_pub_socket, "MEMORY_IOC", 10, ZMQ_SNDMORE);
                            zmq_send(zmq_pub_socket, json, strlen(json), 0);
                            std::cout << "[MEM SCANNER] IOC Found in PID " << processID << " (" << szProcessName << "): " << match << std::endl;
                        }
                    }
                }
            }
            pAddress += memInfo.RegionSize;
        } else {
            break;
        }
    }
    CloseHandle(hProcess);
}

int main() {
    void* zmq_ctx = zmq_ctx_new();
    zmq_pub_socket = zmq_socket(zmq_ctx, ZMQ_PUB);
    zmq_connect(zmq_pub_socket, "tcp://127.0.0.1:5555");

    std::cout << "[MEM SCANNER] Loading YARA rules..." << std::endl;
    auto rules = yara::load_rules("data/yara_rules/");

    std::cout << "[MEM SCANNER] Starting read-only memory scans..." << std::endl;
    while (true) {
        DWORD aProcesses[1024], cbNeeded, cProcesses;
        if (EnumProcesses(aProcesses, sizeof(aProcesses), &cbNeeded)) {
            cProcesses = cbNeeded / sizeof(DWORD);
            for (unsigned int i = 0; i < cProcesses; i++) {
                if (aProcesses[i] != 0 && aProcesses[i] != GetCurrentProcessId()) {
                    ScanProcessMemory(aProcesses[i], rules);
                }
            }
        }
        std::this_thread::sleep_for(std::chrono::seconds(30));
    }
    
    return 0;
}
