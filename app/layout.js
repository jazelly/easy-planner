import "../roadmap.css";

export const metadata = {
  title: "Weekly Task Roadmap",
  description: "Weekly roadmap planner"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
