import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { 
  LayoutDashboard, 
  Phone, 
  Upload as UploadIcon,
  Cable, 
  CreditCard, 
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  User as UserIcon,
  Activity,
  Workflow,
  Ticket as TicketIcon,
  UserPlus,
  ListTodo
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { useGetMe } from "@workspace/api-client-react";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Calls", href: "/calls", icon: Phone },
  { label: "New Call", href: "/calls/new", icon: UploadIcon },
  { label: "Tickets", href: "/tickets", icon: TicketIcon },
  { label: "Leads", href: "/leads", icon: UserPlus },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Automation Rules", href: "/automation-rules", icon: Workflow },
  { label: "Integrations", href: "/integrations", icon: Cable },
  { label: "Billing", href: "/billing", icon: CreditCard },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { signOut } = useClerk();
  const { data: me } = useGetMe();
  const { user } = useUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <div className="flex flex-col space-y-1 mt-6">
      {NAV_ITEMS.map((item) => {
        // "/calls" should highlight for /calls and /calls/:id but NOT for /calls/new
        // (which has its own nav item). All other items just exact-match.
        const isActive =
          location === item.href ||
          (item.href === "/calls" &&
            location.startsWith("/calls/") &&
            location !== "/calls/new");
        return (
          <Link key={item.href} href={item.href} onClick={onClick}>
            <div
              className={`flex items-center space-x-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
              <span className="font-medium text-sm">{item.label}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card">
        <div className="p-4 flex items-center space-x-3 border-b border-border/50 h-16">
          <Activity className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg tracking-tight">CallCommand AI</span>
        </div>
        <ScrollArea className="flex-1 px-3">
          <NavLinks />
        </ScrollArea>
        <div className="p-4 border-t border-border/50">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start px-2 py-6 h-auto">
                <div className="flex items-center space-x-3 w-full">
                  <Avatar className="h-9 w-9 border border-border">
                    <AvatarImage src={me?.avatarUrl || user?.imageUrl} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground"><UserIcon className="h-4 w-4" /></AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col items-start overflow-hidden">
                    <span className="text-sm font-medium truncate w-full">{me?.name || "Operator"}</span>
                    <span className="text-xs text-muted-foreground truncate w-full">{me?.email}</span>
                  </div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation("/settings")}>
                <SettingsIcon className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Mobile Topbar */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card h-16">
          <div className="flex items-center space-x-2">
            <Activity className="h-5 w-5 text-primary" />
            <span className="font-bold tracking-tight">CallCommand AI</span>
          </div>
          
          <div className="flex items-center space-x-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={me?.avatarUrl || user?.imageUrl} />
                    <AvatarFallback><UserIcon className="h-4 w-4" /></AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/settings")}>Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut(() => setLocation("/"))}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-card p-0 border-r border-border">
                <div className="p-4 flex items-center justify-between border-b border-border/50 h-16">
                  <div className="flex items-center space-x-2">
                    <Activity className="h-5 w-5 text-primary" />
                    <span className="font-bold tracking-tight">CallCommand AI</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
                <div className="px-3">
                  <NavLinks onClick={() => setMobileMenuOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-background p-4 md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
