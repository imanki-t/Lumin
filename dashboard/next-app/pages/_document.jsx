import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en" style={{ colorScheme: 'dark' }}>
      <Head>
        <meta name="theme-color" content="#000000" />
        <meta name="color-scheme" content="dark" />
        <link rel="icon" type="image/png" href="/lumin.png" />

        {/* Geist fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />

        {/* xterm.js */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css"
        />
        <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js" />
        <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js" />
      </Head>

      <body>
        <Main />
        <NextScript />
        {/*
          Load the existing vanilla‑JS app bundle as an ES module.
          This tag is emitted verbatim into the HTML — React doesn't
          manage it, so it works exactly like the original <script type="module">.
        */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script type="module" src="/js/app.js" />
      </body>
    </Html>
  );
}
