import { th } from "@/i18n/th";

// Placeholder home page until T-021. The `main` landmark comes from the shell.
export default function HomePage() {
  return (
    <section className="container-page flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
      <h1 className="type-page-title">{th.scaffold.heading}</h1>
      <p>{th.scaffold.body}</p>
    </section>
  );
}
