// Read-only hardware smoke test for the same HID backend shipped in the app.
fn main() {
    let api = hidapi::HidApi::new().expect("HID enumeration");
    let mut found = 0;
    let mut total_packets = 0;
    for info in api.device_list().filter(|info| info.vendor_id() == 0x054c
        && matches!(info.product_id(), 0x0ce6 | 0x0df2) && info.usage_page() == 1 && info.usage() == 5) {
        found += 1;
        match info.open_device(&api) {
            Ok(device) => {
                let mut feature = [0u8; 41]; feature[0] = 5;
                println!("Full report feature request: {:?}", device.get_feature_report(&mut feature));
                let mut raw = [0; 128];
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                let mut packets = 0;
                let mut format = None;
                while std::time::Instant::now() < deadline {
                    let length = device.read_timeout(&mut raw, 50).expect("HID input read");
                    if length > 0 { packets += 1; format = Some((raw[0], length)); }
                }
                println!("DualSense {:04x}: packets={packets}, last format={format:?}", info.product_id());
                total_packets += packets;
            }
            Err(error) => println!("DualSense open failed: {error}"),
        }
    }
    assert!(found > 0, "no physical DualSense found");
    assert!(total_packets > 0, "no input packets received from any DualSense interface");
}
