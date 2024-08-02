// ip
export const VPN = "cap_ip_is_vpn";
export const TOR = "cap_ip_is_tor";
export const RESIDENTIAL = "cap_ip_is_residential";
export const DATACENTER = "cap_ip_is_datacenter";

// mode
export const HEADLESS = "cap_headless"; // decently powerful
export const HEADFUL = "cap_headful"; // most powerful
export const HTTP_REQUESTS = "cap_http_requests"; // just makes http request

// bypass
export const BYPASS_NONE = "cap_bypass_none";
export const BYPASS_CAPTCHAS = "cap_bypass_captchas";

export const ALL_CAPS = [
    VPN,
    TOR,
    RESIDENTIAL,
    DATACENTER,
    HEADLESS,
    HEADFUL,
    HTTP_REQUESTS,
    BYPASS_NONE,
    BYPASS_CAPTCHAS
];