#include <iostream>
#include <string>
#include <windows.h>
#include <evntrace.h>
#include <evntcons.h>
#include <tdh.h>
#include <zmq.h>
#include <chrono>

#pragma comment(lib, "tdh.lib")

void* zmq_pub_socket = nullptr;

void WINAPI ProcessEvent(PEVENT_RECORD pEvent) {
    // In a full implementation, we'd use TdhGetProperty to parse the event payload.
    // For this demonstration of Native Absolute Symphony, we grab the raw header info.
    DWORD pid = pEvent->EventHeader.ProcessId;
    DWORD tid = pEvent->EventHeader.ThreadId;
    
    // We only care about user-mode processes, filter out system (pid 4, 0)
    if (pid <= 4) return;
    
    auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
        
    char json[512];
    snprintf(json, sizeof(json),
             "{\"topic\":\"SYSCALL_EVENT\",\"ts\":%lld,\"pid\":%lu,\"tid\":%lu,\"syscall\":\"etw_event\",\"process\":\"%lu\",\"action\":\"LOGGED\",\"sensor\":\"etw_monitor\",\"os\":\"windows\"}",
             now, pid, tid, pid);
             
    zmq_send(zmq_pub_socket, "SYSCALL_EVENT", 13, ZMQ_SNDMORE);
    zmq_send(zmq_pub_socket, json, strlen(json), 0);
}

void StartRealETWTrace() {
    TRACEHANDLE hTrace = 0;
    EVENT_TRACE_LOGFILEA logFile = { 0 };
    
    // We subscribe to the NT Kernel Logger for Process/Thread events
    logFile.LoggerName = (char*)"NT Kernel Logger";
    logFile.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
    logFile.EventRecordCallback = (PEVENT_RECORD_CALLBACK)ProcessEvent;
    
    hTrace = OpenTraceA(&logFile);
    if (hTrace == INVALID_PROCESSTRACE_HANDLE) {
        std::cerr << "[ETW MONITOR] FATAL: Failed to open trace. Administrator privileges required." << std::endl;
        exit(1);
    }
    
    std::cout << "[ETW MONITOR] Native ETW trace opened successfully. Consuming events..." << std::endl;
    
    // This blocks and consumes events continuously
    ULONG status = ProcessTrace(&hTrace, 1, 0, 0);
    if (status != ERROR_SUCCESS && status != ERROR_CANCELLED) {
        std::cerr << "[ETW MONITOR] FATAL: ProcessTrace failed with status: " << status << std::endl;
        exit(1);
    }
    
    CloseTrace(hTrace);
}

int main() {
    void* zmq_ctx = zmq_ctx_new();
    zmq_pub_socket = zmq_socket(zmq_ctx, ZMQ_PUB);
    zmq_connect(zmq_pub_socket, "tcp://127.0.0.1:5555");

    std::cout << "[ETW MONITOR] ETW Consumer Module Started (Native Execution Mode)." << std::endl;
    
    // Absolute Symphony enforces real Native ETW trace consumption. No simulations.
    StartRealETWTrace();

    return 0;
}
