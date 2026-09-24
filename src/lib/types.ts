export type UserRole = "student" | "parent" | "tutor" | "admin";

export type ExamBoard = "AQA" | "Edexcel" | "OCR_A" | "OCR_B" | "WJEC" | "CIE";

export type StemSubject =
  | "Mathematics"
  | "Further_Maths"
  | "Physics"
  | "Chemistry"
  | "Biology"
  | "Computing";

export type BookingStatus = "scheduled" | "completed" | "cancelled";
export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  email: string;
  avatar_url: string | null;
  created_at: string;
  stripe_customer_id?: string | null;
}

export interface TutorProfile {
  id: string;
  bio: string | null;
  hourly_rate: number; // GBP pence
  dbs_verified: boolean;
  subjects: StemSubject[];
  boards: ExamBoard[];
  rating: number;
  headline?: string | null;
  years_experience?: number | null;
  sessions_taught?: number | null;
  stripe_account_id?: string | null;
  stripe_payouts_enabled?: boolean;
}

export interface StudentProfile {
  id: string;
  parent_id: string | null;
  target_grades: Record<string, string> | null;
  enrolled_subjects: StemSubject[];
}

export interface Availability {
  id: string;
  tutor_id: string;
  day_of_week: number; // 0-6, Sun-Sat
  start_time: string;
  end_time: string;
  is_recurring: boolean;
}

export interface Booking {
  id: string;
  student_id: string;
  tutor_id: string;
  subject: StemSubject | null;
  exam_board: ExamBoard | null;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  webrtc_room_url: string | null;
  started_at?: string | null;
  last_joined_at?: string | null;
  created_at: string;
  payment_status: PaymentStatus;
  amount_gbp_pence: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  lesson_name?: string | null;
  lesson_request_id?: string | null;
  is_trial?: boolean;
  recurrence_rule?: string | null;
  recurrence_series_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_invoice_url?: string | null;
  invoice_sent_at?: string | null;
}

export interface SessionRecording {
  id: string;
  booking_id: string;
  egress_id: string | null;
  storage_path: string;
  status: "starting" | "active" | "stopping" | "ready" | "failed" | "expired";
  started_at: string;
  ended_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface LessonRequest {
  id: string;
  student_id: string;
  tutor_id: string;
  subject: StemSubject;
  exam_board: ExamBoard;
  requested_start_time: string;
  requested_end_time: string;
  is_trial: boolean;
  status: "pending" | "declined" | "scheduled";
  created_at: string;
  responded_at: string | null;
}

export interface SessionAnalytics {
  id: string;
  booking_id: string;
  full_transcript: string | null;
  summary_notes: {
    overview?: string;
    covered_topics?: { spec_point: string; title: string }[];
    misconceptions?: string[];
    homework?: string[];
  } | null;
  talk_ratio: number | null;
  recording_path?: string | null;
  created_at: string;
}

export interface SessionEmbedding {
  id: string;
  booking_id: string;
  student_id: string;
  content: string;
  topic: string | null;
}

export interface DirectConversation {
  id: string;
  student_id: string;
  tutor_id: string;
  created_at: string;
  updated_at: string;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  created_at: string;
}
