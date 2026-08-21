"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

export default function PublicationDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    api(`/publications/${params.id}`).then(setData).catch(console.error);
  }, [params.id]);
  return (
    <div>
      <h1>Publication Detail</h1>
      <pre className="panel">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
