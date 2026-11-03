import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { buttonClass } from "@/components/ui";
import { useNoIndex, useTitle } from "@/lib/title";
import { useAuth } from "@/lib/auth";

function Message({ title, body }: { title: string; body: string }) {
  useTitle(title);
  useNoIndex();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>
      <Links />
    </div>
  );
}

/** Signed in: back to the dashboard. Visitors: the home page, blog and pricing. */
function Links() {
  const { session } = useAuth();
  if (session)
    return (
      <Link to="/dashboard" className={`${buttonClass("secondary")} mt-6`}>
        Go to dashboard
      </Link>
    );
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-2">
      <Link to="/" className={buttonClass("primary")}>
        Go to home
      </Link>
      <Link to="/blog" className={buttonClass("secondary")}>
        Read the blog
      </Link>
      <Link to="/pricing" className={buttonClass("ghost")}>
        Pricing
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
