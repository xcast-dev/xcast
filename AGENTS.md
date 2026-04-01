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

```
src/        React UI — components, screens, hooks
app/        Protocol logic — no React, no UI
├── auth/         Authentication (Device Code, XSTS, tokens)
├── streaming/    Session lifecycle (start, state machine, keepalive)
├── webrtc/       RTCPeerConnection, SDP, ICE
├── channels/     Data channels (message, control, input, chat)
├── input/        Binary input serialization (gamepad, mouse, keyboard)
└── render/       WebGPU renderer, audio
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