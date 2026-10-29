// Keep the task inbox on one API contract during application updates.
// The existing flow endpoint remains available for older CRM clients.
export { GET, POST, PATCH } from "../flows/activity/route";
