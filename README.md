# New Apostolic Church Kumasi Central — Management System

An enterprise-grade, cloud-synchronized Church Management System for **New Apostolic Church Kumasi Central** (Ghana), backed by **Supabase PostgreSQL**.

---

## 🚀 Features

- **Cloud Database (Supabase PostgreSQL)**: Synchronizes members, offerings, church and ministry dues, services, attendance, and settings across all devices.
- **Local-First & Offline Capable**: Instant initial load with local caching and automatic background cloud sync.
- **Role-Based Access Control (RBAC)**:
  - `main-admin`: Full access across all church data, user management, and system settings.
  - `admin`: Day-to-day church operations (members, attendance, scheduling).
  - `account`: Dues and financial records recording and verification.
  - `member`: Congregation directory only (blocked from admin workspace).
- **Ghanaian Financial Rails**: Track offerings and dues in $\text{GH₵}$ with Mobile Money (MTN MoMo, Telecel Cash, AirtelTigo Money) approval workflows.
- **Light / Dark Mode**: Built-in responsive theme switcher.

---

## 📂 Modular Architecture & Directory Structure

```text
New-Apostolic-Church-/
├── index.html                   # Clean, semantic workspace layout (~780 lines)
├── login.html                   # Lightweight authentication portal (~40 lines)
│
├── css/                         # Dedicated stylesheets
│   ├── styles.css               # Main application design system & responsive layout
│   └── login.css                # Authentication portal styles
│
├── js/                          # Core JavaScript architecture
│   ├── supabase-client.js       # Cloud database integration & bi-directional sync engine
│   ├── access.js                # Session management & Role-Based Access Control (RBAC)
│   ├── notifications.js         # Global toast notification system
│   ├── slideshow.js             # Hero carousel & background image animator
│   ├── login.js                 # Authentication, Supabase sign-in & theme logic
│   ├── ui.js                    # Profile customization, avatar upload & theme switcher
│   └── modules/                 # Isolated domain business modules
│       ├── members.js           # Member registry, auto NAC ID generator, department sync
│       ├── departments.js       # Department management & synchronized selectors
│       ├── services.js          # Sunday service schedule & calendar sync
│       ├── attendance.js        # Attendance tracker & weekly rosters
│       ├── dues.js              # Church general dues & Ministry dues tracking
│       ├── offerings.js         # Sunday offerings & Thanksgiving records
│       ├── momo.js              # Ghanaian Mobile Money integration (MTN, Telecel, AT)
│       ├── ministers.js         # Ministers directory, bios & photo gallery
│       ├── announcements.js     # Church bulletins & announcements
│       ├── users.js             # User accounts administration & password management
│       ├── activity.js          # System audit trail & CSV export
│       ├── reports.js           # Report filtering & PDF/CSV export engine
│       ├── settings.js          # Church profile, preferences & cloud controls
│       └── dashboard.js         # Executive KPI cards, growth trends & birthdays
│
├── img/                         # Optimized image assets (sanctuary, entrance, choir, logo)
├── supabase-schema.sql          # Complete PostgreSQL schema, tables, RLS policies & seeds
└── register-foster-admin.sql    # One-click SQL query to provision the Main Admin account
```

---

## ⚡ Quick Start & Cloud Activation

1. Open your project on **[supabase.com](https://supabase.com)**.
2. In the left-hand sidebar, open **SQL Editor**.
3. Copy and run `supabase-schema.sql` to initialize all database tables.
4. Copy and run `register-foster-admin.sql` to provision the Main Admin account.
5. Open `login.html` in your browser to sign in!
