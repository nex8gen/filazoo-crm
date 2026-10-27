export const emailTemplates: Record<string, { subject: string; body: string }> = {
  helpful_reminder: { subject: "Just checking in", body: "Hi {{first_name}},\n\nI wanted to follow up and see whether I can help with your filament requirements.\n\nBest,\nFilazoo" },
  send_catalog: { subject: "Filazoo product catalog", body: "Hi {{first_name}},\n\nI've attached our current product catalog. Reply with the materials and volumes you need and we will prepare pricing.\n\nBest,\nFilazoo" },
  quote_follow_up: { subject: "Following up on your quote", body: "Hi {{first_name}},\n\nDo you have any questions about the quote? I am happy to adjust quantities, materials, or delivery options.\n\nBest,\nFilazoo" },
  welcome_intro: { subject: "Welcome to Filazoo", body: "Hi {{first_name}},\n\nThanks for getting in touch with Filazoo. Tell us what you print and we will recommend the best materials.\n\nBest,\nFilazoo" },
  last_chance: { subject: "Should I close the loop?", body: "Hi {{first_name}},\n\nI have not heard back, so I will close the loop for now. If the project is still active, just reply and we will pick it up.\n\nBest,\nFilazoo" },
};

export function renderFlowTemplate(value: string, contact: { name: string | null; email: string }) {
  const firstName = contact.name?.trim().split(/\s+/)[0] || contact.email.split("@")[0] || "there";
  return value.replaceAll("{{first_name}}", firstName);
}
