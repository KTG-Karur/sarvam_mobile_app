'use client';

import { useState, useEffect, useRef } from 'react';
import { Camera, X, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';

export interface AadhaarQRData {
  uid?: string; // Masked Aadhaar UID
  name: string;
  gender: string;
  dob: string; // DD/MM/YYYY
  address: string;
  pincode?: string;
  photo?: string;
  email?: string;
  phone?: string;
}

export interface AadhaarQRScannerProps {
  onScanSuccess?: (data: AadhaarQRData) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

type ScanStatus = 'idle' | 'scanning' | 'processing' | 'success' | 'error';

export function AadhaarQRScanner({ onScanSuccess, onError, disabled = false }: AadhaarQRScannerProps) {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<AadhaarQRData | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        try {
          scannerRef.current.clear().catch((err) => console.log('Scanner cleanup error:', err));
        } catch (error) {
          console.log('Scanner cleanup error:', error);
        }
      }
    };
  }, []);

  const decodeAadhaarQR = async (qrData: string): Promise<AadhaarQRData | null> => {
    try {
      const response = await apiClient.post<AadhaarQRData>('/kyc/aadhaar-qr-decode', {
        qrData,
      });

      if (!response || !response.success || !response.data) {
        throw new Error(response?.message || 'Failed to decode Aadhaar QR');
      }

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to decode QR code';
      console.error('Aadhaar QR decode error:', error);
      throw new Error(errorMsg);
    }
  };

  const startScanning = async () => {
    if (status === 'scanning' || !containerRef.current) return;

    try {
      setStatus('scanning');
      setErrorMessage(null);
      setScannedData(null);
      processingRef.current = false;

      const scanner = new Html5QrcodeScanner(
        containerRef.current.id,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
          showTorchButtonIfSupported: true,
          disableFlip: false,
        },
        false
      );

      scannerRef.current = scanner;

      scanner.render(
        async (decodedText) => {
          // Prevent processing multiple scans simultaneously
          if (processingRef.current) return;
          processingRef.current = true;

          setStatus('processing');

          try {
            const decodedData = await decodeAadhaarQR(decodedText);

            if (decodedData && decodedData.name) {
              setStatus('success');
              setScannedData(decodedData);
              onScanSuccess?.(decodedData);
            } else {
              setStatus('error');
              setErrorMessage('Unable to extract Aadhaar information from QR code. Please try again.');
              onError?.('Invalid Aadhaar QR code format');
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Failed to decode QR code';
            setStatus('error');
            setErrorMessage(errorMsg);
            onError?.(errorMsg);
          } finally {
            if (scannerRef.current) {
              scannerRef.current.clear().catch((err) => console.log('Scanner stop error:', err));
            }
          }
        },
        (error) => {
          if (!error.includes('QR code not found in image')) {
            console.debug('Scanner error:', error);
          }
        }
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to start camera';
      setStatus('error');
      setErrorMessage(errorMsg);
      onError?.(errorMsg);
      console.error('Error starting QR scanner:', error);
    }
  };

  const stopScanning = () => {
    if (scannerRef.current) {
      scannerRef.current.clear().catch((err) => console.log('Scanner stop error:', err));
      scannerRef.current = null;
    }
    setStatus('idle');
  };

  const reset = () => {
    stopScanning();
    setScannedData(null);
    setErrorMessage(null);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Scan Aadhaar QR Code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Scanner Container */}
        <div
          ref={containerRef}
          id="qr-reader"
          className={cn('rounded-lg border-2 border-dashed border-gray-300 bg-gray-50', {
            'p-4': status !== 'scanning',
            hidden: status === 'idle' || status === 'success',
          })}
        />

        {/* Idle State */}
        {status === 'idle' && (
          <Button
            onClick={startScanning}
            disabled={disabled}
            className="w-full"
            size="lg"
            variant="default"
          >
            <Camera className="mr-2 h-4 w-4" />
            Open Camera & Scan Aadhaar QR
          </Button>
        )}

        {/* Scanning State */}
        {status === 'scanning' && (
          <div className="space-y-2">
            <p className="text-sm text-sidebar-accent">
              Position your Aadhaar card's QR code in front of the camera...
            </p>
            <Button onClick={stopScanning} variant="outline" className="w-full">
              <X className="mr-2 h-4 w-4" />
              Cancel Scan
            </Button>
          </div>
        )}

        {/* Error State */}
        {status === 'error' && errorMessage && (
          <>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Scan Failed</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
            <Button onClick={startScanning} className="w-full" variant="outline">
              <Camera className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </>
        )}

        {/* Success State */}
        {status === 'success' && scannedData && (
          <>
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Aadhaar QR Scanned Successfully</AlertTitle>
              <AlertDescription className="text-green-700">
                The information from your Aadhaar has been extracted.
              </AlertDescription>
            </Alert>

            {/* Scanned Data Display */}
            <div className="space-y-2 rounded-lg bg-green-50 p-4">
              {scannedData.name && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Name</p>
                  <p className="text-sm text-foreground">{scannedData.name}</p>
                </div>
              )}
              {scannedData.dob && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Date of Birth</p>
                  <p className="text-sm text-foreground">{scannedData.dob}</p>
                </div>
              )}
              {scannedData.gender && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Gender</p>
                  <p className="text-sm text-foreground">{scannedData.gender}</p>
                </div>
              )}
              {scannedData.address && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Address</p>
                  <p className="text-sm text-foreground">{scannedData.address}</p>
                </div>
              )}
              {scannedData.pincode && (
                <div>
                  <p className="text-xs font-semibold text-slate-500">Pincode</p>
                  <p className="text-sm text-foreground">{scannedData.pincode}</p>
                </div>
              )}
            </div>

            <Button onClick={reset} variant="outline" className="w-full">
              <Camera className="mr-2 h-4 w-4" />
              Scan Another Aadhaar
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
