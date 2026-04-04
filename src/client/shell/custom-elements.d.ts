/**
 * JSX IntrinsicElements declarations for custom web components
 * still used in the React shell during the Lit → React migration.
 *
 * These allow TypeScript to accept custom element tags in JSX
 * without errors. As each component is migrated to React,
 * its entry here should be removed.
 */

import "react";
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "token-login": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "username-input": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "pattern-input": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "show-select-label"?: boolean;
          "adaptive-size"?: boolean;
        },
        HTMLElement
      >;
      "flag-input": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "show-select-label"?: boolean;
        },
        HTMLElement
      >;
      "game-mode-selector": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "lang-selector": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "game-starting-modal": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "gutter-ads": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      "pattern-button": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          pattern?: unknown;
          colorPalette?: unknown;
          requiresPurchase?: boolean;
          onSelect?: () => void;
          onPurchase?: (p: unknown, cp: unknown) => void;
        },
        HTMLElement
      >;
    }
  }
}
