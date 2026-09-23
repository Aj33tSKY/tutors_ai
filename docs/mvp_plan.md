# MVP Implementation Plan: UK A-Level STEM Tutor Management & Learning Platform

## 1. Executive Summary & Tech Stack

An all-in-one tutor management agency and learning platform tailored for UK A-Level STEM students (Mathematics, Further Maths, Computing, Physics, Chemistry, Biology). The platform handles discovery, scheduling, live video sessions over WebRTC with real-time transcription, automated key topic extraction, student analytics tracking, and a lightweight RAG-enabled chatbot for continuous post-session revision.

### Core Tech Stack

* **Frontend Framework:** Next.js 14+ (App Router, Server Actions, React Server Components)

* **Styling & UI Components:** Tailwind CSS, shadcn/ui, Lucide Icons

* **Backend & Database:** Supabase

  * **Auth:** Supabase Auth (Role-Based Access Control: `student`, `parent`, `tutor`, `admin`)

  * **Database:** PostgreSQL (with `pgvector` extension enabled for AI embeddings)

  * **Storage:** Supabase Storage (for tutor verification documents, profile avatars, topic resource PDFs)

  * **Realtime:** Supabase Realtime (for session notifications and active chat/booking updates)

* **Live Video (WebRTC):** Daily.co / LiveKit WebRTC SDK (Provides server-side audio egress/WebSockets for streaming raw audio to AI transcription engines)

* **Speech-to-Text & Transcription:** Deepgram Nova-2 / OpenAI Whisper API (cost-effective alternative to desktop-bound tools like Granola)

* **AI / LLM Orchestration:** OpenAI API (`gpt-4o-mini` for chat & summary extraction) + LangChain / LlamaIndex / Vercel AI SDK

* **Hosting & Deployment:** Vercel (Edge Functions, Cron Jobs)

* **Payments & Billing:** Stripe Connect (handling tutor payouts, recurring session subscriptions)

## 2. Core User Roles & Key Journeys

### A. Tutors

1. **Onboarding & Verification:** Sign up, upload DBS check & qualification proof, set hourly rates, select A-Level STEM exam boards (Edexcel, AQA, OCR A/B).

2. **Availability Management:** Set weekly recurring availability and sync Google Calendar / Outlook.

3. **Session Delivery:** Conduct WebRTC sessions directly in-browser; optional quick note jotting during calls.

### B. Students & Parents

1. **Discovery & Matching:** Filter tutors by Subject, Exam Board, Hourly Rate, Rating, and Availability.

2. **Booking & Calendar:** Book single sessions or setup recurring weekly billing slots with automated calendar invites (.ics).

3. **Interactive Dashboard:** View past session topic breakdowns, syllabus coverage maps, homework tasks, and talk time analytics.

4. **AI Revision Assistant:** Chat with a chatbot grounded in the student's actual session transcripts, syllabus specs, and personal strengths/weaknesses.

## 3. Core System Architecture & Data Schema

```
+-----------------------------------------------------------------------------------+
|                                  NEXT.JS (VERCEL)                                 |
|                                                                                   |
|  +--------------------+   +---------------------+   +--------------------------+  |
|  | Booking & Calendar |   | WebRTC Video Room   |   | Analytics & Chatbot GUI  |  |
|  +---------+----------+   +----------+----------+   +------------+-------------+  |
+------------|-------------------------|---------------------------|----------------+
             |                         |                           |
             v                         v                           v
+------------------------+  +---------------------+   +--------------------------+
|  Supabase Postgres DB  |  | Audio Stream / Pipe |   | Vercel AI SDK            |
|  (Auth, Slots, RAG)    |  +----------+----------+   | (GPT-4o-mini + Vector)   |
+------------------------+             |              +-------------+------------+
                                       v                            |
                            +---------------------+                 |
                            | Deepgram / Whisper  |                 |
                            | Realtime Audio STT  |                 |
                            +----------+----------+                 |
                                       |                            |
                                       v                            |
                            +---------------------+                 |
                            | Session Summarizer  |<----------------+
                            | & Key Topic Extractor|
                            +---------------------+

```

### Database Schema (Supabase PostgreSQL)

```
-- Enable Vector extension for AI RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- User Roles
CREATE TYPE user_role AS ENUM ('student', 'parent', 'tutor', 'admin');
CREATE TYPE exam_board AS ENUM ('AQA', 'Edexcel', 'OCR_A', 'OCR_B', 'WJEC', 'CIE');
CREATE TYPE stem_subject AS ENUM ('Mathematics', 'Further_Maths', 'Physics', 'Chemistry', 'Biology');

-- Profiles Table
CREATE TABLE profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  role user_role NOT NULL DEFAULT 'student',
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tutor Details Table
CREATE TABLE tutor_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  bio TEXT,
  hourly_rate INT NOT NULL, -- in GBP Pence
  dbs_verified BOOLEAN DEFAULT FALSE,
  subjects stem_subject[] NOT NULL,
  boards exam_board[] NOT NULL,
  rating NUMERIC(2, 1) DEFAULT 5.0
);

-- Student Profiles Table
CREATE TABLE student_profiles (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES profiles(id),
  target_grades JSONB, -- e.g. {"Physics": "A*"}
  enrolled_subjects stem_subject[]
);

-- Availability Slots
CREATE TABLE availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID REFERENCES tutor_profiles(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL, -- 0-6 (Sun-Sat)
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_recurring BOOLEAN DEFAULT TRUE
);

-- Bookings / Sessions Table
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES profiles(id),
  tutor_id UUID REFERENCES profiles(id),
  subject stem_subject NOT NULL,
  exam_board exam_board NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'completed', 'cancelled'
  webrtc_room_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session Transcripts & Analytics (Core Data Pipe)
CREATE TABLE session_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE UNIQUE,
  full_transcript TEXT,
  summary_notes JSONB, -- Key topics, homework assigned, misunderstandings identified
  talk_ratio NUMERIC(3,2), -- Tutor vs Student talk percentage
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings for Chatbot RAG Grounding
CREATE TABLE session_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL, -- Chunked transcript/summary line
  topic TEXT,
  embedding vector(1536) -- OpenAI text-embedding-3-small dimension
);

-- Vector Search Index
CREATE INDEX ON session_embeddings USING ivfflat (embedding vector_cosine_ops);

```

## 4. Primary Feature Breakdown

### Module 1: Tutor Discovery & Booking System

* **Tutor Profiles:** Dynamic filtering by STEM subject, A-Level board, pricing tier, and availability.

* **Calendar Logic:**

  * Real-time slot reservation using Supabase DB locks to prevent double booking.

  * Support for single ad-hoc sessions or recurring weekly subscriptions via Stripe Billing API.

  * Automated `.ics` generation sent via email (Resend / SendGrid API).

### Module 2: Integrated WebRTC Video Room & Transcription Engine

* **WebRTC Implementation:** Built using Daily.co or LiveKit SDK for low-latency video/audio streaming.

* **In-Room Features:** Integrated whiteboard (Excalidraw API), text chat, screen sharing, and code/formula editor (KaTeX support).

* **Transcription Pipe:**

  1. Room audio stream piped server-side to **Deepgram WebSocket API**.

  2. Generates real-time transcript with speaker diarization (separating `Tutor` vs `Student`).

  3. Audio stream discarded post-session; raw transcript saved securely to `session_analytics`.

### Module 3: Post-Session Analytics Engine

* **LLM Summary Pipeline:** Upon session conclusion, a background job (Vercel Cron / Queue) triggers `gpt-4o-mini` to extract:

  * **Covered Topics:** Aligned with official UK Specification points (e.g., *Edexcel Physics 4.2 Particle Accelerators*).

  * **Key Misconceptions & Weak Points:** Identified student knowledge gaps.

  * **Assigned Homework & Action Points.**

* **Student Dashboard:** Visual progress ring showing specification coverage per subject, session timeline, and talk-time breakdown.

### Module 4: Grounded Revision AI Chatbot

* **RAG Architecture:** Contextual retrieval over the student’s `session_embeddings` table.

* **Bot Behavior:**

  * Answers student questions using the exact methods/explanations their tutor used in live sessions.

  * Generates custom UK A-Level practice questions (e.g., 3-mark or 6-mark exam style questions) tailored to the student's registered weak points.

  * Accessible 24/7 on student/parent web dashboard.

## 5. Development Roadmap & Milestones

| Phase | Milestone | Core Deliverables | Timeline | 
 | ----- | ----- | ----- | ----- | 
| **Phase 1** | **Foundation & Auth** | Supabase setup, Next.js scaffolding, Auth with Role management, Profile creation (Student/Tutor). | Week 1 - 2 | 
| **Phase 2** | **Booking & Payments** | Tutor availability matrix, Calendar booking UI, Stripe integration for single/recurring bookings. | Week 3 - 4 | 
| **Phase 3** | **WebRTC & Transcription** | LiveKit/Daily.co room integration, in-browser call controls, server-side real-time transcription pipe via Deepgram. | Week 5 - 6 | 
| **Phase 4** | **Analytics & Extraction** | Post-session processing job, LLM spec-mapping script, Student Analytics & Progress Dashboard UI. | Week 7 - 8 | 
| **Phase 5** | **RAG Chatbot & Polish** | Supabase Vector setup, Vercel AI SDK chat interface, UK A-Level exam prompt engineering, E2E testing. | Week 9 - 10 | 

## 6. UK Compliance & Security

* **GDPR & Data Retention:** Audio streams are processed in-memory and destroyed immediately after transcription. Raw transcripts are encrypted at rest in Supabase.

* **Child Safety & Safeguarding:**

  * Mandatory DBS (Disclosure and Barring Service) upload gate for tutor verification.

  * Parent account linkage for under-18 students, allowing parents full view of session analytics, transcripts, and chatbot logs.

````

```markdown:Project Execution Roadmap:project_next_steps.md
# Quick-Start Execution Guide

### 1. Initial Environment Setup
Run the following commands in your local directory to initialize the Next.js app with Supabase and UI modules:

```bash
npx create-next-app@latest stem-tutor-uk --typescript --tailwind --eslint --app
cd stem-tutor-uk
npx shadcn-ui@latest init
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs @livekit/components-react livekit-server-sdk @deepgram/sdk ai openai

````

### 2. Configure Supabase Environment Variables

Create a `.env.local` file in your root folder:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-supabase-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# LiveKit / Daily WebRTC Credentials
LIVEKIT_API_KEY=your-livekit-key
LIVEKIT_API_SECRET=your-livekit-secret
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud

# AI & Transcription Setup
DEEPGRAM_API_KEY=your-deepgram-key
OPENAI_API_KEY=your-openai-key

```

### 3. Immediate Action Items

1. Apply the database SQL script provided in `plan.md` inside your **Supabase SQL Editor**.

2. Run `npm run dev` to begin component development.

```

eof

```