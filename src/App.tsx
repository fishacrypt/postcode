import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BookOpen, Building2, FileBadge2, Gauge, History, KeyRound, LayoutDashboard, MapPin, Settings, ShieldCheck, Users, Lock, ScrollText } from 'lucide-react'
import { AuthProvider } from '@/lib/auth'
import { PublicLayout } from '@/layouts/PublicLayout'
import { DashboardLayout, type NavItem } from '@/layouts/DashboardLayout'
import { Landing } from '@/pages/public/Landing'
import { BusinessSolutions, Contact, Faq, Features, HowItWorks, PrivacyPolicy, PrivacySecurity, Terms } from '@/pages/public/Content'
import { Docs } from '@/pages/public/Docs'
import { VerifyPage } from '@/pages/public/VerifyPage'
import { ForgotPassword, Login, Register, ResetPassword, VerifyEmail } from '@/pages/auth/AuthPages'
import { OverviewPage } from '@/pages/app/OverviewPage'
import { AddressPage } from '@/pages/app/AddressPage'
import { CredentialsPage } from '@/pages/app/CredentialsPage'
import { HistoryPage, SecurityPage, SettingsPage } from '@/pages/app/AccountPages'
import { PrivacyPage } from '@/pages/app/PrivacyPage'
import { ApiKeysPage, BusinessOverview, BusinessProfile, UsagePage } from '@/pages/business/BusinessPages'
import { AdminAudit, AdminBusinesses, AdminCredentials, AdminSystem, AdminUsers, IssuerCredentials } from '@/pages/admin/AdminPages'

const USER_NAV: NavItem[] = [
  { to: '/app', label: 'Overview', icon: <LayoutDashboard />, end: true },
  { to: '/app/address', label: 'My Address', icon: <MapPin /> },
  { to: '/app/credentials', label: 'My Credentials', icon: <FileBadge2 /> },
  { to: '/app/history', label: 'Verification History', icon: <History /> },
  { to: '/app/privacy', label: 'Privacy & Consent', icon: <ShieldCheck /> },
  { to: '/app/security', label: 'Security', icon: <Lock /> },
  { to: '/app/settings', label: 'Settings', icon: <Settings /> },
]
const BUSINESS_NAV: NavItem[] = [
  { to: '/business', label: 'Requests', icon: <LayoutDashboard />, end: true },
  { to: '/business/keys', label: 'API keys', icon: <KeyRound /> },
  { to: '/business/usage', label: 'Usage and history', icon: <Gauge /> },
  { to: '/business/profile', label: 'Business profile', icon: <Building2 /> },
  { to: '/docs', label: 'Documentation', icon: <BookOpen /> },
  { to: '/business/security', label: 'Security', icon: <Lock /> },
]
const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Users', icon: <Users />, end: true },
  { to: '/admin/businesses', label: 'Businesses', icon: <Building2 /> },
  { to: '/admin/audit', label: 'Audit log', icon: <ScrollText /> },
  { to: '/admin/credentials', label: 'Credentials', icon: <FileBadge2 /> },
  { to: '/admin/system', label: 'System', icon: <Gauge /> },
  { to: '/admin/security', label: 'Security', icon: <Lock /> },
]
const ISSUER_NAV: NavItem[] = [
  { to: '/issuer', label: 'Credentials', icon: <FileBadge2 />, end: true },
  { to: '/issuer/security', label: 'Security', icon: <Lock /> },
]

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<Landing />} />
            <Route path="how-it-works" element={<HowItWorks />} />
            <Route path="features" element={<Features />} />
            <Route path="privacy-security" element={<PrivacySecurity />} />
            <Route path="business-solutions" element={<BusinessSolutions />} />
            <Route path="docs" element={<Docs />} />
            <Route path="faq" element={<Faq />} />
            <Route path="contact" element={<Contact />} />
            <Route path="privacy" element={<PrivacyPolicy />} />
            <Route path="terms" element={<Terms />} />
          </Route>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="verify" element={<VerifyPage />} />

          <Route path="app" element={<DashboardLayout roles={['user']} nav={USER_NAV} title="Your account" />}>
            <Route index element={<OverviewPage />} />
            <Route path="address" element={<AddressPage />} />
            <Route path="credentials" element={<CredentialsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="business" element={<DashboardLayout roles={['business']} nav={BUSINESS_NAV} title="Business" />}>
            <Route index element={<BusinessOverview />} />
            <Route path="keys" element={<ApiKeysPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="profile" element={<BusinessProfile />} />
            <Route path="security" element={<SecurityPage />} />
          </Route>
          <Route path="admin" element={<DashboardLayout roles={['admin']} nav={ADMIN_NAV} title="Administration" />}>
            <Route index element={<AdminUsers />} />
            <Route path="businesses" element={<AdminBusinesses />} />
            <Route path="system" element={<AdminSystem />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="credentials" element={<AdminCredentials />} />
            <Route path="security" element={<SecurityPage />} />
          </Route>
          <Route path="issuer" element={<DashboardLayout roles={['issuer']} nav={ISSUER_NAV} title="Issuer" />}>
            <Route index element={<IssuerCredentials />} />
            <Route path="security" element={<SecurityPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
