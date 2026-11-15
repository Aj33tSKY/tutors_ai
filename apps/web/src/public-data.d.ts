import type { PublicTutor, TutorCatalogue } from "../../../packages/contracts/src/tutors.js";
/** Data a prerendered page embeds so its first paint already has content. */
declare global { interface Window { __PUBLIC_DATA__?: { catalogue?: TutorCatalogue; tutor?: PublicTutor } } }
export {};
