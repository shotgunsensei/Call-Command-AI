import { useGetMe } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LogOut, User, Mail, Shield } from "lucide-react";

export default function Settings() {
  const { data: me, isLoading } = useGetMe();
  const { signOut } = useClerk();

  if (isLoading || !me) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your operator profile and system preferences.</p>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Operator Profile</CardTitle>
          <CardDescription>Your personal intelligence clearance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
            <Avatar className="h-24 w-24 border-2 border-border">
              <AvatarImage src={me.avatarUrl || undefined} />
              <AvatarFallback className="text-2xl bg-secondary text-secondary-foreground">
                {me.name ? me.name.charAt(0).toUpperCase() : <User className="h-10 w-10" />}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-4 flex-1 text-center md:text-left">
              <div>
                <h3 className="text-2xl font-semibold">{me.name || "Operator"}</h3>
                <p className="text-muted-foreground flex items-center justify-center md:justify-start mt-1">
                  <Mail className="h-4 w-4 mr-2" />
                  {me.email}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                <Badge variant="secondary" className="px-3 py-1">
                  <Shield className="h-3 w-3 mr-1" />
                  Clearance: Level {me.plan === 'free' ? 1 : me.plan === 'pro' ? 2 : me.plan === 'business' ? 3 : 4}
                </Badge>
                <Badge variant="outline" className="px-3 py-1 uppercase border-primary text-primary">
                  {me.plan} Plan
                </Badge>
                {me.demoMode && (
                  <Badge variant="destructive" className="px-3 py-1">DEMO MODE</Badge>
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-border mt-6">
            <h4 className="text-sm font-medium mb-4 uppercase text-muted-foreground tracking-wider">Account Actions</h4>
            <Button variant="destructive" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out of HQ
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
