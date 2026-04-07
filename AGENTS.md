# AGENTS.md

Instructions for AI coding agents working on xcast.

## Project overview

xcast is an open-source Xbox Remote Play client built with Vite + React + TypeScript. It streams from a physical Xbox console over WebRTC, rendered via WebGPU.

## Stack

- **Runtime:** Browser (Vite dev server), packaged with Electron later
- **UI:** React 19 + TypeScript + shadcn/ui + Tailwind CSS v4
- **Styling:** shadcn/ui components only — do not write raw CSS unless strictly necessary

## Setup

```bash
npm install
npm run dev
```

## Project structure

> **Keep this section up to date.** After every significant change (new module, new screen, new server route), update the tree below before committing.

```
src/        React UI — components, screens, hooks
├── screens/
│   ├── Login.tsx         Device Code login flow (con timer y progress)
│   ├── ConsoleList.tsx   Console selection (SmartGlass, gamepad navigation, badges)
│   ├── StreamView.tsx    Streaming view (WebGPU + fallback video)
│   └── Settings.tsx      User preferences (quality, metrics, volume, H.264 profile)
├── components/
│   ├── GamepadVisualizer.tsx   Debug overlay para gamepad
│   ├── XboxBootLogo.tsx        Xbox logo draw animation during connection
│   └── ui/               shadcn/ui components
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── badge.tsx
│       ├── separator.tsx
│       ├── alert.tsx
│       ├── skeleton.tsx
│       ├── progress.tsx
│       ├── sonner.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── switch.tsx
│       ├── tooltip.tsx
│       ├── label.tsx
│       └── slider.tsx
app/        Protocol logic — no React, no UI
├── auth/
│   ├── devicecode.ts     Device Code flow + token refresh
│   ├── xsts.ts           XBL → XSTS → xHome chain (AuthSession)
│   └── persistence.ts    Session storage + lazy refresh
├── consoles/
│   └── smartglass.ts     Console discovery via xccs.xboxlive.com
├── streaming/
│   ├── session.ts        Session lifecycle (startSession, pollUntilProvisioned, startKeepalive, deleteSession)
│   └── reconnect.ts      Transparent stream reconnection with retry/backoff
├── webrtc/
│   └── negotiation.ts    RTCPeerConnection setup, SDP offer/answer, ICE exchange, data channels, gamepad input
└── input/                Binary input serialization (inline in negotiation.ts)
server/
├── index.ts      Fastify setup + plugin registration
└── routes/
    ├── auth.ts       /auth/* (devicecode, token, xbl, xsts, xhome, purpose)
    ├── smartglass.ts /smartglass/devices
    └── streaming.ts  /streaming/* (play, state, connect, keepalive, sdp, ice, delete)
```

## Code style

- TypeScript strict mode — no `any`, no type assertions without justification
- Functional components only, no class components
- Imports use the `@/` alias for `src/`
- Do not add comments unless the logic is non-obvious

## Adding UI components

Use the shadcn CLI — do not write component files by hand:

```bash
npx shadcn@latest add <component>
```
