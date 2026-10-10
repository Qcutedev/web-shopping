import { th } from "@/i18n/th";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-bold">{th.scaffold.heading}</h1>
      <p>{th.scaffold.body}</p>
    </main>
  );
}
