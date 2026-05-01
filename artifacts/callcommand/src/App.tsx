import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Layout from "@/components/layout";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Calls from "@/pages/calls";
import CallDetail from "@/pages/call-detail";
import Upload from "@/pages/upload";
import Integrations from "@/pages/integrations";
import Billing from "@/pages/billing";
import Settings from "@/pages/settings";
import AutomationRulesPage from "@/pages/automation-rules";
import TicketsPage from "@/pages/tickets";
import LeadsPage from "@/pages/leads";
import TasksPage from "@/pages/tasks";
import ChannelsPage from "@/pages/channels";
import FlowsPage from "@/pages/flows";
import FlowDetailPage from "@/pages/flow-detail";
import SimulatePage from "@/pages/simulate";
import SimulateLiveCallPage from "@/pages/simulate-live-call";
import SwitchboardPage from "@/pages/switchboard";
import SetupTelephonyPage from "@/pages/setup-telephony";
import ReceptionistProfilesPage from "@/pages/receptionist-profiles";
import TransferTargetsPage from "@/pages/transfer-targets";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(0 84% 50%)",
    colorForeground: "hsl(0 0% 98%)",
    colorMutedForeground: "hsl(240 5% 65%)",
    colorBackground: "hsl(240 10% 6%)",
    colorInput: "hsl(240 10% 16%)",
    colorInputForeground: "hsl(0 0% 98%)",
    colorDanger: "hsl(0 84% 50%)",
    colorNeutral: "hsl(240 10% 12%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#0f0f12] border border-[#1c1c20] rounded-xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-semibold tracking-tight",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary hover:text-primary/90 font-medium",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-500",
    alertText: "text-destructive",
    logoBox: "h-12 w-12 flex items-center justify-center mx-auto mb-4",
    logoImage: "w-full h-full object-contain",
    socialButtonsBlockButton: "border border-border bg-input hover:bg-input/80 text-foreground",
    formButtonPrimary: "bg-primary hover:bg-primary/90 text-primary-foreground font-medium",
    formFieldInput: "bg-input border-border text-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    footerAction: "bg-transparent",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive/20 border text-destructive",
    otpCodeFieldInput: "bg-input border-border text-foreground",
    formFieldRow: "mb-4",
    main: "gap-6",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      <div className="z-10 w-full flex justify-center">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      <div className="z-10 w-full flex justify-center">
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  return (
    <Route {...rest}>
      <Show when="signed-in">
        <Layout>
          <Component />
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </Route>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "HQ Login",
            subtitle: "Access your tactical command center",
          },
        },
        signUp: {
          start: {
            title: "Enlist Now",
            subtitle: "Deploy CallCommand AI for your team",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          
          <ProtectedRoute path="/dashboard" component={Dashboard} />
          <ProtectedRoute path="/calls" component={Calls} />
          <ProtectedRoute path="/calls/new" component={Upload} />
          <ProtectedRoute path="/calls/:id" component={CallDetail} />
          <ProtectedRoute path="/integrations" component={Integrations} />
          <ProtectedRoute path="/automation-rules" component={AutomationRulesPage} />
          <ProtectedRoute path="/switchboard" component={SwitchboardPage} />
          <ProtectedRoute path="/setup/telephony" component={SetupTelephonyPage} />
          <ProtectedRoute path="/channels" component={ChannelsPage} />
          <ProtectedRoute path="/flows" component={FlowsPage} />
          <ProtectedRoute path="/flows/:id" component={FlowDetailPage} />
          <ProtectedRoute path="/simulate" component={SimulatePage} />
          <ProtectedRoute path="/simulate/live-call" component={SimulateLiveCallPage} />
          <ProtectedRoute path="/receptionist-profiles" component={ReceptionistProfilesPage} />
          <ProtectedRoute path="/transfer-targets" component={TransferTargetsPage} />
          <ProtectedRoute path="/tickets" component={TicketsPage} />
          <ProtectedRoute path="/leads" component={LeadsPage} />
          <ProtectedRoute path="/tasks" component={TasksPage} />
          <ProtectedRoute path="/billing" component={Billing} />
          <ProtectedRoute path="/settings" component={Settings} />
          
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
