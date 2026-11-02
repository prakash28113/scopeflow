import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { buttonClass } from "@/components/ui";
import { useNoIndex, useTitle } from "@/lib/title";

function Message({ title, body }: { title: string; body: string }) {
  useTitle(title);
  useNoIndex();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>
      <Link to="/dashboard" className={`${buttonClass("secondary")} mt-6`}>
        Go to dashboard
      </Link>
    </div>
  );
}

export default function NotFound() {
  return <Message title="Page not found" body="It may have been moved, or you may not have access to it." />;
}

export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  console.error(error);
  return <Message title="Something went wrong" body="Please reload the page. If it keeps happening, try again later." />;
}
