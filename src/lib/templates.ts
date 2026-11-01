/**
 * Agreement templates: starting points for common freelance work. They only pre-fill the
 * project form — everything stays editable, and nothing is sent until you choose to.
 */
export type Template = {
  id: string;
  name: string;
  /** Included on every plan; the rest belong to the full library. */
  starter: boolean;
  summary: string;
  deliverables: { title: string; description: string; revisions: number }[];
  exclusions: string[];
  terms: string;
};

const PAY = "50% advance before work starts; balance on delivery. Final files are released after full payment.";

export const TEMPLATES: Template[] = [
  {
    id: "graphic-design",
    name: "Graphic design",
    starter: true,
    summary: "Design of the print and digital pieces listed below, from brief to print-ready files.",
    deliverables: [
      { title: "Concept options", description: "2 initial design directions as PDF", revisions: 1 },
      { title: "Final design", description: "Chosen direction refined; print-ready PDF and web PNG/JPG", revisions: 2 },
    ],
    exclusions: ["Copywriting", "Stock photo or font licences", "Printing and delivery costs"],
    terms: PAY,
  },
  {
    id: "brand-identity",
    name: "Brand identity",
    starter: true,
    summary: "A visual identity: logo, colour palette, typography and a compact brand guide.",
    deliverables: [
      { title: "Logo", description: "Primary and secondary marks; colour and mono versions; SVG, PNG, PDF", revisions: 2 },
      { title: "Colour palette and typography", description: "Primary and accent colours with codes; font pairing", revisions: 1 },
      { title: "Brand guidelines", description: "10–12 page PDF covering usage rules", revisions: 1 },
    ],
    exclusions: ["Trademark search or registration", "Website design", "Stock photo or font licences"],
    terms: `${PAY} Ownership of the final logo transfers to the client on full payment.`,
  },
  {
    id: "web-development",
    name: "Website",
    starter: true,
    summary: "Design and build of a responsive marketing website with the pages listed below.",
    deliverables: [
      { title: "Page designs", description: "Up to 5 pages, desktop and mobile layouts", revisions: 2 },
      { title: "Development", description: "Responsive build of the approved designs; contact form", revisions: 1 },
      { title: "Launch", description: "Deployment to the client's hosting; basic on-page SEO", revisions: 0 },
    ],
    exclusions: ["Hosting and domain fees", "Copywriting and photography", "Ongoing maintenance after launch", "E-commerce or payment integration"],
    terms: `${PAY} Bug fixes for 14 days after launch are included.`,
  },
  {
    id: "ui-ux",
    name: "UI/UX design",
    starter: false,
    summary: "User experience and interface design for the screens and flows listed below.",
    deliverables: [
      { title: "User flows and wireframes", description: "Key flows as low-fidelity wireframes", revisions: 1 },
      { title: "UI design", description: "High-fidelity screens for the agreed flows (up to 12 screens)", revisions: 2 },
      { title: "Clickable prototype and handoff", description: "Prototype link and developer-ready design file", revisions: 1 },
    ],
    exclusions: ["Front-end or app development", "User research recruitment and incentives", "Illustrations and icon sets beyond the agreed screens"],
    terms: PAY,
  },
  {
    id: "video-editing",
    name: "Video editing",
    starter: false,
    summary: "Editing of the supplied footage into the videos listed below.",
    deliverables: [
      { title: "Main edit", description: "Up to 3 minutes, colour correction and licensed music", revisions: 2 },
      { title: "Social cut-downs", description: "3 vertical clips, 15–30 seconds, with captions", revisions: 1 },
    ],
    exclusions: ["Filming and travel", "Voice-over artists", "Premium stock footage or music beyond the agreed track", "Motion graphics beyond simple titles"],
    terms: `${PAY} Raw project files are not included unless agreed.`,
  },
  {
    id: "social-marketing",
    name: "Social media marketing",
    starter: false,
    summary: "One month of social media content and posting for the channels listed below.",
    deliverables: [
      { title: "Content calendar", description: "Monthly plan for 2 channels", revisions: 1 },
      { title: "Post designs and captions", description: "12 posts with captions and hashtags", revisions: 2 },
      { title: "Monthly report", description: "Reach, engagement and recommendations", revisions: 0 },
    ],
    exclusions: ["Paid ad spend", "Community management and replies", "Influencer fees", "Photo or video shoots"],
    terms: "Billed monthly in advance. Either side can end the arrangement with 15 days' notice.",
  },
];
