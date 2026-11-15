export type LessonRoom = {
  booking: { id: string; tutor_id: string; student_id: string; subject: string | null; lesson_name: string | null;
    start_time: string; status: string; started_at: string | null };
  isTutor: boolean; recordingConsented: boolean; configured: boolean;
};
export type LessonToken = { token: string; serverUrl: string; roomName: string };
