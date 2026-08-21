"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

export default function LearningRuleDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    api(`/learning-rules/${params.id}`).then(setData).catch(console.error);
  }, [params.id]);
  return (
    <div>
      <h1>Learning Rule Detail</h1>
      <pre className="panel">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
