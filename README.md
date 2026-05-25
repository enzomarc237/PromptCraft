# PromptCraft

# Technical Specification & Architecture Plan: PromptCraft (Prompt Management & Enhancement Web Application)

This document outlines the complete technical specification, architectural design, database schema, and product roadmap for **PromptCraft**, a local-first, highly customizable, and privacy-centric web application for prompt engineering, management, and playground execution.

---

## 1. Executive Summary & Core Philosophy

PromptCraft is designed as a professional-grade workspace for prompt engineers, developers, and AI power users. The application operates under three core principles:
1. **Privacy First (BYOK & Local-First):** All API keys, prompt histories, and custom templates are stored locally on the user's device. AI requests are sent directly from the client to the provider APIs (OpenAI, Anthropic, Gemini, Mistral, Ollama) without passing through an intermediary application server.
2. **Offline Resilience:** The application is fully functional offline. Users can write, organize, tag, and search their entire prompt library, manage variables, and view historical runs without an internet connection.
3. **Developer-Grade UX:** The interface mirrors the speed and efficiency of modern IDEs, incorporating keyboard-driven navigation, slash commands, side-by-side prompt comparisons, and dynamic variable compilation.

---

## 2. Recommended Tech Stack

To achieve a high-performance, local-first web application with robust offline capabilities and native-like performance, we recommend the following modern stack:

### Frontend & Core Application
* **Framework:** **React 18+** with **Vite** (or **Next.js** in Static Export / SPA mode) for ultra-fast builds and rendering.
* **Language:** **TypeScript** for strict type safety across prompt schemas, provider APIs, and state management.
* **Styling:** **Tailwind CSS** combined with **Shadcn UI** (Radix UI primitives) for a highly polished, keyboard-accessible, and customizable developer interface.
* **State Management:** **Zustand** for lightweight, transient application state (e.g., active panels, UI toggles) and **TanStack Query (React Query)** for asynchronous data fetching and polling.

### Local-First Database & Synchronization
* **Primary Database:** **RxDB (Reactive Database)** or **SQLite (via WASM / OPFS - Origin Private File System)**.
  * *Why RxDB:* It provides real-time reactive queries (using RxJS), built-in encryption fields (crucial for API keys), schema validation using JSON Schema, and out-of-the-box replication adapters for syncing (CouchDB, WebSockets, Supabase, etc.).
* **Storage Engine:** **IndexedDB** via RxDB's Dexie.js or custom SQLite WASM backend for persistent, high-capacity client-side storage.
* **Sync Protocol:** **CouchDB Replication Protocol** or **Electric SQL / Supabase Realtime** for optional multi-device synchronization with end-to-end encryption (E2EE).

### AI Integration & HTTP Client
* **HTTP Client:** Native `fetch` with stream-reading capabilities to support real-time token-by-token streaming from AI providers.
* **SDKs:** Direct integration with official client libraries or standard HTTP requests matching OpenAI-compatible endpoints to keep the bundle size small and flexible.

---

## 3. System Architecture & Data Flow

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CLIENT BROWSER                                      │
│                                                                                        │
│  ┌─────────────────────────┐     ┌─────────────────────────┐    ┌───────────────────┐  │
│  │       UI Component      │◄───►│      Zustand Store      │◄──►│    RxDB / Local   │  │
│  │   (Playground / Editor) │     │    (UI State / Stream)  │    │  Database (OPFS)  │  │
│  └────────────┬────────────┘     └─────────────────────────┘    └─────────┬─────────┘  │
│               │                                                           │            │
│               │ (Direct API Call)                                         │            │
│               ▼                                                           │            │
│  ┌─────────────────────────┐                                              │            │
│  │   Direct API Clients    │                                              │            │
│  │ (OpenAI, Anthropic, etc)│                                              │            │
│  └────────────┬────────────┘                                              │            │
└───────────────┼───────────────────────────────────────────────────────────┼────────────┘
                │                                                           │
                │ HTTPS (Streaming Responses)                               │ Sync (E2EE)
                ▼                                                           ▼
┌───────────────────────────────┐                          ┌─────────────────────────────┐
│      AI Provider APIs         │                          │      Self-Hosted Sync       │
│ (OpenAI, Anthropic, Gemini,   │                          │  (CouchDB / Supabase / etc) │
│  Mistral, Ollama Local)       │                          └─────────────────────────────┘
└───────────────────────────────┘
```

### Data Isolation & Privacy Flow
1. **No Proxy Server:** The browser initiates direct HTTPS requests to `https://api.openai.com`, `https://api.anthropic.com`, etc.
2. **CORS Handling:** For providers that do not support browser CORS directly, the app provides a toggle to use a **user-specified local proxy** (like Ollama running on `localhost:11434`) or a **custom self-hosted CORS proxy** where the user controls the infrastructure.
3. **Key Security:** API keys are encrypted in IndexedDB using **AES-GCM** with a key derived from a user-defined Master Password via **PBKDF2**. The key is only held in-memory (Zustand state) during the session and never written to disk in plain text.

---

## 4. UX/UI Optimization for Power Users

To elevate the application from a simple text repository to a powerhouse IDE for prompt engineering, we specify the following UX enhancements:

### A. Split-Screen Prompt Playground
* **Side-by-Side Execution:** Run the exact same prompt template with different variable inputs or across different models (e.g., GPT-4o vs Claude 3.5 Sonnet) simultaneously.
* **Real-time Diffing:** Visual diff highlighting (using `diff-match-patch`) to compare the outputs of two prompt variations or two different model outputs.
* **Token & Cost Counter:** Real-time estimation of input/output tokens and cost calculation based on current provider pricing tables.

### B. Interactive Variable & Parameter Parsing
* **Dynamic Variable Extraction:** As the user types a prompt, variables wrapped in double curly braces (e.g., `{{user_profile}}` or `{{context}}`) are automatically parsed in real-time.
* **Auto-Generated Input Forms:** A dynamic sidebar instantly renders input fields (textareas, dropdowns, file uploaders) for each detected variable.
* **System Prompts & Chaining:** Ability to define a global "System Prompt" and chain multiple prompts together, where the output of Prompt A automatically populates a variable in Prompt B.

### C. Command Palette & Keyboard-First Navigation
* **Slash Commands (`/`):** Inside the prompt editor, typing `/` opens a quick-insert menu for variables, dynamic system dates, preset system instructions (e.g., "Act as a senior coder"), or code block templates.
* **Global Command Palette (`Cmd+K` or `Ctrl+K`):** Instant search across all saved prompts, quick model switching, theme toggles, and navigation.
* **Vim Mode Toggle:** An optional Vim keybinding overlay for the prompt editor (leveraging Monaco Editor or CodeMirror 6).

### D. Advanced Prompt Versioning
* **Git-like Commit History:** Every save creates a new immutable version of the prompt. Users can add change logs (e.g., "Adjusted temperature guidelines").
* **Version Comparison:** Side-by-side visual diff of prompt templates across different commits, with the ability to rollback to any historical version.

---

## 5. Offline Functionality & Data Sync

To guarantee zero latency and full offline capability, the application implements a **local-first architecture**.

### A. Database Schema (RxDB / SQLite)
The local database utilizes relational schemas with conflict resolution metadata. Below is the entity-relationship design optimized for synchronization:

#### 1. `prompts` Table
Stores the metadata and core configuration of a prompt.
```sql
CREATE TABLE prompts (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    folder_id VARCHAR(36),
    tags TEXT, -- JSON array of strings: ["coding", "refactoring"]
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE, -- Soft delete for sync
    version INTEGER DEFAULT 1
);
```

#### 2. `prompt_versions` Table
Stores the actual prompt templates and settings over time.
```sql
CREATE TABLE prompt_versions (
    id VARCHAR(36) PRIMARY KEY,
    prompt_id VARCHAR(36) NOT NULL,
    version_number INTEGER NOT NULL,
    system_prompt TEXT,
    user_prompt_template TEXT NOT NULL,
    hyperparameters TEXT, -- JSON string: {"temperature": 0.7, "max_tokens": 1000}
    provider VARCHAR(50) NOT NULL, -- e.g., "openai", "anthropic"
    model VARCHAR(100) NOT NULL, -- e.g., "gpt-4o", "claude-3-5-sonnet"
    commit_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
);
```

#### 3. `folders` Table
Enables hierarchical organization.
```sql
CREATE TABLE folders (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id VARCHAR(36), -- Supports nested folders
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);
```

#### 4. `variables` Table
Global variables that can be shared across multiple prompts.
```sql
CREATE TABLE variables (
    id VARCHAR(36) PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL, -- e.g., "global_tone"
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE
);
```

#### 5. `sync_metadata` Table
Tracks synchronization status per table for incremental syncing.
```sql
CREATE TABLE sync_metadata (
    table_name VARCHAR(100) PRIMARY KEY,
    last_synced_row_version INTEGER NOT NULL,
    last_synced_at TIMESTAMP NOT NULL
);
```

### B. Offline Synchronization Strategy
1. **Change Tracking:** Every mutation (insert, update, delete) increments the local `version` counter and updates the `updated_at` timestamp. Deletes are marked as `is_deleted = TRUE` (soft delete) to ensure deletion propagates to other devices during sync.
2. **Conflict Resolution (LWW - Last-Write-Wins & Manual Merge):**
   * *Automatic:* The system defaults to **Last-Write-Wins (LWW)** based on the high-precision `updated_at` timestamp.
   * *Manual:* If a conflict is detected where two devices modified the same prompt template version concurrently (divergent histories), the UI prompts the user with a side-by-side conflict resolution screen, showing the local changes, remote changes, and a merge option.
3. **Network Resilience:** A background Service Worker monitors network connectivity (`navigator.onLine`). When the connection is restored, it triggers a background synchronization worker that pushes local changes to the remote sync server (e.g., Supabase or CouchDB) and pulls down remote changes.

---

## 6. Personalization & Settings Module

The settings module is designed to allow granular control over every aspect of the workspace:

### A. UI/UX Customization
* **Theme Engine:** Dark, Light, and System themes. Custom color presets (Slate, Emerald, Violet, Amber) and custom CSS font selection (e.g., Fira Code, JetBrains Mono, SF Pro).
* **Layout Configuration:** Toggleable sidebars, adjustable pane ratios for the playground, and configurable font sizes/line heights for prompt editors.
* **Keybinding Manager:** Fully customizable hotkeys for executing prompts, switching models, opening search, and saving versions.

### B. Default Hyperparameters & Templates
* **Global Defaults:** Set default temperature, top-p, frequency penalty, and max tokens for new playground instances.
* **Global System Prompts:** Define default system prompts (e.g., "Explain things simply" or "Output valid JSON only") that automatically attach to new prompts.

### C. Provider Credentials & Privacy
* **API Key Management:** Individual inputs for OpenAI, Anthropic, Google Gemini, Mistral, OpenRouter, and Ollama.
* **Local Encryption Password:** Option to require a master password on app startup to decrypt stored API keys.
* **Custom Endpoint/Proxy:** Ability to override the base URL for any provider (e.g., pointing OpenAI to a local Gateway or an enterprise proxy).

---

## 7. AI Integration (BYOK) & Dynamic Model Management

To remain highly versatile and ensure zero maintenance overhead when new models are released, PromptCraft implements a robust **Bring Your Own Key (BYOK)** model combined with **Dynamic Model Management**.

### A. Secure Client-Side BYOK Architecture
* API keys are never sent to a backend server.
* They are stored locally in IndexedDB, encrypted with **AES-256-GCM** using a key derived from the user's master password.
* When a request is initiated, the key is decrypted in memory, attached to the authorization header (e.g., `Authorization: Bearer <KEY>`), and dispatched directly to the AI provider.

### B. Dynamic Model Discovery
Instead of hardcoding model lists (which quickly become outdated), PromptCraft queries provider discovery APIs dynamically.

#### 1. OpenAI & OpenRouter
* **Endpoint:** `GET https://api.openai.com/v1/models` or `GET https://openrouter.ai/api/v1/models`
* **Headers:** `Authorization: Bearer <USER_KEY>`
* **Implementation:**
  * Fetch the list of models.
  * Filter based on capability (e.g., models containing `gpt` or supported text generation capabilities).
  * Cache the list locally in IndexedDB for 24 hours. Provide a manual "Refresh Models" button in the UI.

#### 2. Anthropic
* Anthropic does not currently expose a public endpoint for listing models dynamically.
* **Solution:** PromptCraft maintains a local, up-to-date fallback array (e.g., `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`) but also allows users to input a **"Custom Model ID"** directly in the settings, ensuring compatibility with any newly announced Anthropic models immediately.

#### 3. Google Gemini
* **Endpoint:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=<USER_KEY>`
* **Implementation:** Parse the response payload to list all models supporting the `generateContent` action.

#### 4. Ollama (Local LLMs)
* **Endpoint:** `GET http://localhost:11434/api/tags`
* **Implementation:** Fetch all locally downloaded models running on the user's machine and display them instantly in the model dropdown.

---

## 8. Detailed Feature & Implementation Roadmap

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                                  ROADMAP                                  │
├───────────────────┬───────────────────────────────────┬───────────────────┤
│ PHASE 1: CORE     │ PHASE 2: POWER USER UX            │ PHASE 3: SYNC &   │
│ (Weeks 1 - 4)     │ (Weeks 5 - 8)                     │ ENHANCEMENTS      │
│                   │                                   │ (Weeks 9 - 12)    │
├───────────────────┼───────────────────────────────────┼───────────────────┤
│ • Local DB Setup  │ • Split-Screen Playground         │ • E2EE Cloud Sync │
│ • Editor & Sidebar│ • Version Control & Visual Diff   │ • Prompt Chaining │
│ • BYOK Storage    │ • Variable Auto-Parsing & Forms   │ • Team Sharing &  │
│ • Basic Execution │ • Slash Commands & Vim Mode       │   Export Formats  │
└───────────────────┴───────────────────────────────────┴───────────────────┘
```

### Phase 1: Core Foundation (Weeks 1-4)
* **Milestone 1.1:** Initialize the React/TypeScript codebase with Tailwind and Shadcn UI.
* **Milestone 1.2:** Configure RxDB with IndexedDB adapter. Define schemas for `prompts`, `folders`, and `variables`.
* **Milestone 1.3:** Build the secure Settings panel with encrypted key storage for OpenAI, Anthropic, Gemini, and Ollama.
* **Milestone 1.4:** Implement dynamic model fetching for OpenAI, Gemini, and Ollama.
* **Milestone 1.5:** Create the basic Prompt Editor with system prompt configuration and streaming response support.

### Phase 2: Power User UX & Playground (Weeks 5-8)
* **Milestone 2.1:** Implement the split-screen playground with side-by-side prompt execution.
* **Milestone 2.2:** Build the dynamic variable parser using regex compiled on editor change, generating instant sidebar forms.
* **Milestone 2.3:** Add the visual diffing engine to compare outputs of different models/runs.
* **Milestone 2.4:** Integrate keyboard shortcut manager and the `Cmd+K` command palette.
* **Milestone 2.5:** Create the Git-like versioning system, enabling users to commit prompt drafts and view change history.

### Phase 3: Offline Synchronization & Advanced Features (Weeks 9-12)
* **Milestone 3.1:** Implement offline detection and background sync worker using the CouchDB/Supabase replication protocol.
* **Milestone 3.2:** Build the E2EE (End-to-End Encryption) layer for cloud synchronization, ensuring keys and prompts are encrypted before leaving the client.
* **Milestone 3.3:** Design the prompt chaining workflow interface, allowing outputs of one prompt to feed as variables into another.
* **Milestone 3.4:** Add export/import utilities supporting standard formats (JSON, CSV, LangChain prompt formats, Promptfile).
* **Milestone 3.5:** Perform security audit, optimization of IndexedDB query performance, and launch the application.

---

## 9. Conclusion

PromptCraft represents the next generation of prompt engineering tooling. By combining the absolute privacy of a local-first, BYOK architecture with the raw speed and power of an IDE-grade user interface, it provides developers and prompt engineers with a reliable, future-proof workspace.

This specification provides a complete blueprint for immediate engineering implementation.
