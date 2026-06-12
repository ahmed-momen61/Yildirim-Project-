cmake_minimum_required(VERSION 3.10)
project(BayezidNativeSensors)

set(CMAKE_CXX_STANDARD 17)

find_package(PkgConfig REQUIRED)
if (UNIX AND NOT APPLE)
    pkg_check_modules(ZMQ REQUIRED libzmq)
    pkg_check_modules(LIBBPF REQUIRED libbpf)
    
    add_executable(xdp_telemetry_relay linux/xdp_telemetry_relay.c)
    target_link_libraries(xdp_telemetry_relay ${ZMQ_LIBRARIES} ${LIBBPF_LIBRARIES} pthread)
    target_include_directories(xdp_telemetry_relay PUBLIC ${ZMQ_INCLUDE_DIRS} ${LIBBPF_INCLUDE_DIRS})

    add_executable(mem_scanner_linux linux/mem_scanner_linux.cpp)
    target_link_libraries(mem_scanner_linux ${ZMQ_LIBRARIES} pthread)
    target_include_directories(mem_scanner_linux PUBLIC ${ZMQ_INCLUDE_DIRS})

    add_executable(syscall_relay linux/syscall_relay.c)
    target_link_libraries(syscall_relay ${ZMQ_LIBRARIES} ${LIBBPF_LIBRARIES} pthread)
    target_include_directories(syscall_relay PUBLIC ${ZMQ_INCLUDE_DIRS} ${LIBBPF_INCLUDE_DIRS})
elseif (WIN32)
    # Placeholder for Windows ZMQ linking - will expect ZMQ to be available or downloaded
    # ZMQ_LIBRARIES and ZMQ_INCLUDE_DIRS would need to be set or fetched via vcpkg
    add_executable(wfp_striker windows/wfp_striker.cpp)
    target_link_libraries(wfp_striker fwpuclnt.lib rpcrt4.lib ws2_32.lib # libzmq
    )

    add_executable(mem_scanner_win windows/mem_scanner_win.cpp)
    target_link_libraries(mem_scanner_win psapi.lib # libzmq
    )

    add_executable(etw_monitor windows/etw_monitor.cpp)
    target_link_libraries(etw_monitor tdh.lib # libzmq
    )
endif()
