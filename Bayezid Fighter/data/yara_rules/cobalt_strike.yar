rule CobaltStrike_Beacon_x64
{
    meta:
        description = "Detects Cobalt Strike Beacon memory signatures"
        author = "Bayezid Blue Team"
        date = "2026-05-30"
        
    strings:
        // Basic CS Beacon signatures
        $mz = "MZ"
        $dos_stub = "This program cannot be run in DOS mode"
        $cs_url = "/submit.php?id="
        $cs_beacon = "beacon.x64.dll"
        
        // Characteristic memory artifacts
        $sleep_mask = { 55 48 8B EC 48 83 EC 20 48 89 4D 10 48 8B 45 10 48 8B 40 08 48 85 C0 74 15 }

    condition:
        $mz at 0 and $dos_stub and (any of ($cs_*)) or $sleep_mask
}
