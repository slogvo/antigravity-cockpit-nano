# Antigravity Cockpit Nano

[English](README.md) · [Tiếng Việt](#tiếng-việt-vietnamese)

[![Version](https://img.shields.io/open-vsx/v/slogvo/antigravity-cockpit-nano)](https://open-vsx.org/extension/slogvo/antigravity-cockpit-nano)
[![License](https://img.shields.io/github/license/slogvo/antigravity-cockpit-nano)](https://github.com/slogvo/antigravity-cockpit-nano)

**Antigravity Cockpit Nano** is a lightweight VS Code extension for monitoring your Google Antigravity AI credentials and quota.

**Features**: Webview Dashboard · QuickPick Mode · Quota Grouping · Status Bar Monitor · Threshold Notifications · Auto Wake-up

**Languages**: English, Vietnamese 🇻🇳

---

## English

### Features

#### Dashboard

Two display modes available in settings (`agCockpit.displayMode`):

1.  **Webview Dashboard**: Full UI with cards or list view.
2.  **QuickPick Mode**: Lightweight menu for keyboard users or restricted environments.

#### Status Bar

Monitors quota remaining. Supports 6 formats:

-   Icon Only: `🚀`
-   Dot: `🟢`
-   Standard (Default): `🟢 Sonnet: 95%`

#### Auto Wake-up

Schedule automated requests to "wake up" the model and trigger the quota reset cycle in advance.

-   **Flexible Scheduling**: Daily, Weekly, or Advanced Crontab.
-   **Secure**: Credentials stored in VS Code Secret Storage.

### Installation

Install via VS Code Marketplace or Open VSX Registry.

### Configuration

| Setting                      | Default    | Description                     |
| :--------------------------- | :--------- | :------------------------------ |
| `agCockpit.refreshInterval`  | `120`      | Refresh interval in seconds.    |
| `agCockpit.displayMode`      | `webview`  | `webview` or `quickpick`.       |
| `agCockpit.statusBarFormat`  | `standard` | Format of status bar text.      |
| `agCockpit.warningThreshold` | `30`       | % remaining to trigger warning. |

---

## Tiếng Việt (Vietnamese)

**Antigravity Cockpit Nano** là tiện ích mở rộng giúp bạn theo dõi hạn ngạch (quota) của AI Google Antigravity ngay trong VS Code.

**Tính năng chính**:

-   📊 **Dashboard trực quan**: Xem dung lượng còn lại, giờ reset.
-   🚀 **Theo dõi Status Bar**: Hiển thị % còn lại ngay dưới chân màn hình.
-   ⏰ **Auto Wake-up (Tự động gọi)**: Tự động gửi request để kích hoạt chu kỳ reset quota sớm.
-   📁 **Gộp nhóm**: Tự động gộp các model dùng chung quota.

### Cài đặt

Tìm kiếm `Antigravity Cockpit Nano` trên Marketplace và nhấn Install.

### Sử dụng

1.  **Mở Dashboard**: Nhấn `Ctrl+Shift+Q` hoặc tìm lệnh `Antigravity Cockpit: Open Dashboard`.
2.  **Làm mới**: Nhấn nút Refresh trên dashboard.
3.  **Tự động gọi**: Vào tab "Tự động gọi" trong Dashboard để cài đặt lịch chạy (ví dụ chạy lúc 6h sáng để 9h vào làm đã hồi phục quota).

### Cấu hình chính

Vào **Settings** -> **Antigravity Cockpit**:

| Cấu hình            | Mặc định   | Mô tả                                               |
| :------------------ | :--------- | :-------------------------------------------------- |
| `Refresh Interval`  | `120`      | Thời gian tự động làm mới (giây).                   |
| `Status Bar Format` | `standard` | Kiểu hiển thị thanh trạng thái.                     |
| `Language`          | `Auto`     | Tự động nhận diện theo ngôn ngữ VS Code (Anh/Việt). |

---

## Support / Hỗ trợ

-   ⭐ [GitHub Star](https://github.com/slogvo/antigravity-cockpit-nano)
-   💬 [Report Issue / Báo lỗi](https://github.com/slogvo/antigravity-cockpit-nano/issues)

## License

[MIT](LICENSE)

**Disclaimer**: This project is for educational purposes only.
**Miễn trừ trách nhiệm**: Dự án này chỉ phục vụ mục đích học tập và nghiên cứu.
