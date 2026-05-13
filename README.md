<div align="center">

# 🧪 DrunkeeLabs

### _The Next-Gen Coding Task & Evaluation Platform_

[![Built with React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%26%20DB-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Docker](https://img.shields.io/badge/Docker-Sandbox-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-F97316?style=for-the-badge)](LICENSE)

<br />

**DrunkeeLabs** is a full-stack platform where mentors create coding tasks, employees solve them in a live workspace with a built-in code editor, and submissions are auto-evaluated inside secure Docker sandboxes with AI-powered code review.

<br />

[Features](#-features) · [Tech Stack](#-tech-stack) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [Project Structure](#-project-structure) · [Contributing](#-contributing)

</div>

---

## ✨ Features

### 👨‍💻 For Employees (Coders)
- **Interactive Dashboard** — View assigned tasks, track progress, and see earnings at a glance.
- **Live Code Workspace** — Monaco-powered in-browser editor with syntax highlighting and real-time terminal output.
- **Task Marketplace** — Browse and accept available coding challenges with bounty rewards.
- **Submission History** — Review past submissions with detailed status, scores, and AI feedback.
- **Profile & KYC** — Manage profile, complete KYC verification, and handle wallet withdrawals.

### 🧑‍🏫 For Mentors
- **Task Creation Studio** — Rich task builder with markdown support, test-case configuration, and file templates.
- **Submission Review Panel** — Review all employee submissions with code diffs, AI-generated scores, and manual override options.
- **Mentor Dashboard** — Overview of all created tasks with submission counts and approval rates.

### 🛡️ For Admins
- **Admin Control Panel** — Manage users, approve KYC requests, oversee platform activity, and handle payouts.

### ⚙️ Platform-Wide
- 🔐 **Role-Based Auth** — Supabase-powered authentication with Employee / Mentor / Admin roles.
- 🐳 **Docker Sandbox Execution** — Submissions run in isolated containers for safe, reproducible evaluation.
- 🤖 **AI Code Review** — OpenAI-powered automated scoring and feedback on every submission.
- 📊 **Real-Time Updates** — Socket.IO for live task status, terminal logs, and notification events.
- 💳 **Payment Integration** — Razorpay-powered wallet system with QR payments and withdrawal flows.
- 🎨 **Premium UI** — Glassmorphism design, Framer Motion animations, and responsive layout.

---

## 🛠 Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 19** | UI framework with JSX components |
| **Vite 8** | Lightning-fast dev server & build tool |
| **React Router v7** | Client-side routing with role guards |
| **Framer Motion** | Page transitions & micro-animations |
| **Monaco Editor** | VS Code-grade in-browser code editor |
| **Tailwind CSS 3** | Utility-first styling with custom theme |
| **Socket.IO Client** | Real-time WebSocket communication |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js + Express** | REST API server |
| **Supabase JS** | Auth, PostgreSQL database, & file storage |
| **BullMQ + IORedis** | Background job queue for code evaluation |
| **Dockerode** | Programmatic Docker container management |
| **OpenAI SDK** | AI-powered code review & scoring |
| **Multer** | File upload handling |
| **Razorpay** | Payment gateway integration |
| **Socket.IO** | Real-time event broadcasting |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      FRONTEND (Vite + React)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │  Auth    │  │Dashboard │  │Workspace │  │ Admin  │  │
│  │  Pages   │  │  Views   │  │ (Monaco) │  │ Panel  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       └──────────────┴─────────────┴────────────┘       │
│                         │ HTTP / WebSocket               │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                    BACKEND (Express)                     │
│  ┌──────────┐  ┌───────┴──────┐  ┌───────────────────┐  │
│  │ REST API │  │  Socket.IO   │  │  BullMQ Worker    │  │
│  │ Routes   │  │  Events      │  │  (Code Evaluator) │  │
│  └────┬─────┘  └──────────────┘  └────────┬──────────┘  │
│       │                                    │             │
│  ┌────┴────────────────────────────────────┴──────────┐  │
│  │              Supabase (Auth + DB + Storage)        │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────┴────────────────────────────┐  │
│  │          Docker Sandbox (Isolated Execution)       │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+ & **npm**
- **Docker Desktop** (for sandbox code execution)
- **Redis** (for BullMQ job queue)
- **Supabase** project (for auth, database & storage)

### 1. Clone the Repository

```bash
git clone https://github.com/drunkeespaceteam/DrunkeeLabs.git
cd DrunkeeLabs
```

### 2. Frontend Setup

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env.local
```

Add your Supabase credentials to `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3001
```

### 3. Backend Setup

```bash
cd server

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Add your backend credentials to `server/.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-key
RAZORPAY_KEY_ID=your-razorpay-key
RAZORPAY_KEY_SECRET=your-razorpay-secret
REDIS_URL=redis://localhost:6379
```

### 4. Start Development

```bash
# Terminal 1 — Frontend
npm run dev

# Terminal 2 — Backend API
cd server && node index.js

# Terminal 3 — Background Worker
cd server && node worker.js
```

The app will be available at **http://localhost:5173**

---

## 📁 Project Structure

```
DrunkeeLabs/
├── public/                    # Static assets
├── src/
│   ├── components/            # Reusable UI components
│   │   ├── AuthLayout.jsx     #   Auth page wrapper with animations
│   │   ├── ChatPanel.jsx      #   AI chat assistant panel
│   │   ├── CodeBlock.jsx      #   Syntax-highlighted code display
│   │   ├── KYCModal.jsx       #   Identity verification modal
│   │   ├── Navbar.jsx         #   Main navigation bar
│   │   ├── RouteGuard.jsx     #   Role-based route protection
│   │   ├── TaskCard.jsx       #   Task preview card
│   │   ├── TaskWorkspace.jsx  #   Monaco editor + terminal
│   │   └── ...                #   More components
│   ├── context/
│   │   └── AuthContext.jsx    # Global auth state provider
│   ├── lib/
│   │   └── supabase.js        # Supabase client & helpers
│   ├── pages/
│   │   ├── Signin.jsx         # Login page
│   │   ├── Signup.jsx         # Registration page
│   │   ├── Dashboard.jsx      # Employee dashboard
│   │   ├── MentorDashboard.jsx# Mentor overview
│   │   ├── CreateTaskPage.jsx # Task creation form
│   │   ├── TaskWorkspace.jsx  # Code editing workspace
│   │   ├── Submissions.jsx    # Submission history
│   │   ├── AdminDashboard.jsx # Admin control panel
│   │   ├── Profile.jsx        # User profile & wallet
│   │   └── TargetMarketplace.jsx # Task marketplace
│   ├── App.jsx                # Root app with routing
│   ├── main.jsx               # React entry point
│   └── index.css              # Global styles
├── server/
│   ├── index.js               # Express API server
│   ├── worker.js              # BullMQ background worker
│   ├── containerManager.js    # Docker container lifecycle
│   ├── sandbox.js             # Sandbox execution engine
│   ├── create_bucket.cjs      # Supabase storage setup
│   └── package.json           # Server dependencies
├── index.html                 # App entry HTML
├── package.json               # Frontend dependencies
├── tailwind.config.js         # Tailwind CSS configuration
├── postcss.config.js          # PostCSS plugins
├── tsconfig.json              # TypeScript configuration
└── .gitignore                 # Git ignore rules
```

---

## 🔒 Security

- All code submissions execute in **isolated Docker containers** with resource limits.
- **Row-Level Security (RLS)** policies enforce data access rules at the database level.
- **JWT-based authentication** via Supabase with role-based route guards.
- Environment secrets are never committed — managed through `.env` files.

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Commit** your changes: `git commit -m "feat: add amazing feature"`
4. **Push** to the branch: `git push origin feature/amazing-feature`
5. **Open** a Pull Request

---

## 📜 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with 💜 by the DrunkeeLabs Team**

<br />

_If you found this project useful, consider giving it a ⭐!_

</div>
