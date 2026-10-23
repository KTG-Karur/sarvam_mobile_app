'use client';

import dynamic from 'next/dynamic';
import 'swagger-ui-react/swagger-ui.css';
import { useEffect, useState } from 'react';

const SwaggerUI = dynamic(() => import('swagger-ui-react'), { ssr: false });

export default function ApiDocsPage() {
    const [spec, setSpec] = useState(null);

    useEffect(() => {
        // Suppress React strict mode warnings from swagger-ui-react library
        // The library uses legacy lifecycle methods that we cannot control
        const originalError = console.error;
        console.error = (...args) => {
            if (
                typeof args[0] === 'string' &&
                args[0].includes('UNSAFE_componentWillReceiveProps')
            ) {
                return;
            }
            originalError.apply(console, args);
        };

        return () => {
            console.error = originalError;
        };
    }, []);

    useEffect(() => {
        fetch('/api/swagger')
            .then((res) => res.json())
            .then((data) => setSpec(data));
    }, []);

    if (!spec) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                background: '#fafafa'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        border: '3px solid #3b82f6',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto 16px'
                    }} />
                    <p style={{ color: '#666', fontSize: '14px' }}>Loading API Documentation...</p>
                </div>
                <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
            </div>
        );
    }

    return (
        <div style={{ background: '#fff', minHeight: '100vh' }}>
            <SwaggerUI spec={spec} />
        </div>
    );
}
