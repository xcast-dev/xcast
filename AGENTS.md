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
│   ├── Login.tsx         Device Code login flow
│   └── ConsoleList.tsx   Console selection (SmartGlass)
app/        Protocol logic — no React, no UI
├── auth/
│   ├── devicecode.ts     Device Code flow + token refresh
│   ├── xsts.ts           XBL → XSTS → xHome chain (AuthSession)
│   └── persistence.ts    Session storage + lazy refresh
├── consoles/
│   └── smartglass.ts     Console discovery via xccs.xboxlive.com
├── streaming/    Session lifecycle (start, state machine, keepalive)
├── webrtc/       RTCPeerConnection, SDP, ICE
├── channels/     Data channels (message, control, input, chat)
├── input/        Binary input serialization (gamepad, mouse, keyboard)
└── render/       WebGPU renderer, audio
server/
└── index.ts      Fastify CORS proxy (auth + SmartGlass + streaming endpoints)
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