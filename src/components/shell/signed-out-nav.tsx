import Link from "next/link";
import { th } from "@/i18n/th";
import { ROUTES } from "@/lib/routes";
import { CartLink } from "./cart-link";
import { NAV_LINK } from "./nav-link";

/** Header links for a visitor without a session: sign-up, sign-in, and the cart link. */
export function SignedOutNav() {
  return (
    <>
      <Link href={ROUTES.signUp} className={NAV_LINK}>
        {th.shell.header.signUp}
      </Link>
      <Link href={ROUTES.signIn} className={NAV_LINK}>
        {th.shell.header.signIn}
      </Link>
      <CartLink />
    </>
  );
}
