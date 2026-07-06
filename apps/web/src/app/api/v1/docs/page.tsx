'use client';

import { useEffect } from 'react';

export default function ApiDocsPage() {
  useEffect(() => {
    // Load swagger-ui-react
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/swagger-ui-react@5.18.0/swagger-ui.js';
    script.async = true;
    document.body.appendChild(script);

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/swagger-ui-react@5.18.0/swagger-ui.css';
    document.head.appendChild(link);

    return () => {
      document.body.removeChild(script);
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <div id="swagger-ui" style={{ padding: '20px' }} />
      
      <script
        dangerouslySetInnerHTML={{
          __html: `
            window.onload = function() {
              const ui = SwaggerUIBundle({
                url: '/api/openapi',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
                plugins: [SwaggerUIBundle.plugins.DownloadUrl],
                layout: "StandaloneLayout"
              });
            };
          `,
        }}
      />
    </div>
  );
}