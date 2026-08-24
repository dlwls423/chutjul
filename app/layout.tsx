import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './extras.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {metadataBase:new URL('https://chutjul.leeyejin113.chatgpt.site'),title:'첫줄 | 민원 답변 지원',description:'유사 민원과 관련 법령을 근거로 신뢰할 수 있는 답변 초안을 만듭니다.',openGraph:{title:'민원 답변의 첫줄',description:'유사 민원과 법령을 한 화면에서',images:['/og.png']},twitter:{card:'summary_large_image',title:'민원 답변의 첫줄',description:'유사 민원과 법령을 한 화면에서',images:['/og.png']}};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
