import type { Slide } from '@/app/components/auth/LoginCarousel';

/** Built-in default slides — shown on the login page until an admin adds slides via
 *  /dashboard/settings/brand (Login Page Carousel section). */
export const DEFAULT_LOGIN_SLIDES: Slide[] = [
  {
    src: '/login-slides/slide1.png',
    title: 'Empowering Financial Inclusion',
    description: 'Manage members, loans, collections,\nsavings and field operations efficiently.',
  },
  {
    src: '/login-slides/slide2.png',
    title: 'Seamless Loan Management',
    description: 'From application to disbursement,\ntrack every step with ease.',
  },
  {
    src: '/login-slides/slide3.png',
    title: 'Smart Collections',
    description: 'Streamline field collections\nand boost recovery rates.',
  },
  {
    src: '/login-slides/slide4.png',
    title: 'Real-time Insights',
    description: 'Instant reports for smarter\nfinancial decisions.',
  },
  {
    src: '/login-slides/slide5.png',
    title: 'Secure Client Enrollment',
    description: 'Digital KYC and Aadhaar verification\nfor faster onboarding.',
  },
  {
    src: '/login-slides/slide6.png',
    title: 'End-to-End Accounting',
    description: 'Automated GL posting keeps your\nbooks accurate and audit-ready.',
  },
  {
    src: '/login-slides/slide7.png',
    title: 'Multi-Branch Control',
    description: 'Manage regions, divisions and branches\nfrom a single dashboard.',
  },
  {
    src: '/login-slides/slide8.png',
    title: 'Field-Ready Operations',
    description: 'Empower field officers with mobile-first\ncollection and audit tools.',
  },
  {
    src: '/login-slides/slide9.png',
    title: 'Trusted by Communities',
    description: 'Building lasting financial partnerships\nwith the members we serve.',
  },
  {
    src: '/login-slides/slide10.png',
    title: 'Empowering Rural Communities',
    description: 'Bringing accessible credit and savings to the\ndoorsteps of underserved members across every branch.',
  },
  {
    src: '/login-slides/slide11.png',
    title: 'Trusted Financial Partnership',
    description: 'Building long-term relationships through\ntransparent lending and reliable field support.',
  },
];
