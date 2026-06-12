rule Mimikatz_Memory_Pattern
{
    meta:
        description = "Detects Mimikatz logonpasswords and credential dumping artifacts in memory"
        author = "Bayezid Blue Team"
        date = "2026-05-30"

    strings:
        $m1 = "sekurlsa::logonpasswords" nocase wide ascii
        $m2 = "lsadump::sam" nocase wide ascii
        $m3 = "privilege::debug" nocase wide ascii
        $m4 = "wdigest.dll" nocase wide ascii
        $m5 = "kerberos::ptt" nocase wide ascii

    condition:
        2 of ($m*)
}
