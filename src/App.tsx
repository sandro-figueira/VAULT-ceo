import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingFallback } from "@/components/LoadingFallback";
import { usePageView } from "@/hooks/usePageView";

// Lazy load all pages — each becomes its own chunk
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Simulator = lazy(() => import("./pages/Simulator"));
const Results = lazy(() => import("./pages/Results"));
const Signup = lazy(() => import("./pages/Signup"));
const Login = lazy(() => import("./pages/Login"));
const Success = lazy(() => import("./pages/Success"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const TaxDashboard = lazy(() => import("./pages/TaxDashboard"));
const Import = lazy(() => import("./pages/Import"));
const OAuthGmailCallback = lazy(() => import("./pages/OAuthGmailCallback"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Prefetch critical routes after initial paint (Landing → Simulator → Results → Signup)
if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    setTimeout(() => {
      import("./pages/Simulator");
      import("./pages/Login");
    }, 2000);
    setTimeout(() => {
      import("./pages/Results");
      import("./pages/Signup");
    }, 4000);
  }, { once: true });
}

/** Tracks pageviews — must be inside BrowserRouter */
const PageViewTracker = ({ children }: { children: React.ReactNode }) => {
  usePageView();
  return <>{children}</>;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AuthProvider>
        <PageViewTracker>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<Onboarding />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/simulator" element={<Simulator />} />
            <Route path="/results" element={<Results />} />
            <Route path="/success" element={<Success />} />
            <Route
              path="/dashboard"
              element={
                <ErrorBoundary>
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                </ErrorBoundary>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/taxes"
              element={
                <ProtectedRoute>
                  <TaxDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/import"
              element={
                <ProtectedRoute>
                  <Import />
                </ProtectedRoute>
              }
            />
            <Route path="/oauth/gmail-callback" element={<OAuthGmailCallback />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </PageViewTracker>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
