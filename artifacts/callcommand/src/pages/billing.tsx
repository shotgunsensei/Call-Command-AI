import { useGetBillingPlan, useCreateCheckoutSession } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Check, Activity, AlertCircle } from "lucide-react";

export default function Billing() {
  const { data: planData, isLoading } = useGetBillingPlan();
  const createCheckout = useCreateCheckoutSession();
  const { toast } = useToast();

  const handleSubscribe = async (plan: string) => {
    try {
      const res = await createCheckout.mutateAsync({ data: { plan } });
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      toast({
        title: res.configured ? "Checkout Unavailable" : "Payment Configuration",
        description:
          res.message ||
          "Payments are not currently configured for this deployment.",
        duration: 6000,
      });
    } catch (err: any) {
      toast({ title: "Checkout Failed", description: err.message, variant: "destructive" });
    }
  };

  if (isLoading || !planData) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Activity className="h-8 w-8 text-primary animate-pulse" />
      </div>
    );
  }

  const usagePercent = Math.min(100, Math.round((planData.callsThisMonth / planData.monthlyLimit) * 100)) || 0;
  const isNearLimit = usagePercent > 80;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing & Plans</h1>
        <p className="text-muted-foreground">Manage your subscription and deployment capacity.</p>
      </div>

      {/* Current Usage */}
      <Card className="bg-card border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle>Current Capacity: {planData.plan.toUpperCase()}</CardTitle>
          <CardDescription>Your monthly transmission limit resets on the 1st of every month.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm mb-2 font-medium">
            <span>{planData.callsThisMonth} transmissions processed</span>
            <span className={isNearLimit ? "text-destructive" : ""}>{planData.monthlyLimit} limit</span>
          </div>
          <Progress value={usagePercent} className={`h-3 ${isNearLimit ? '[&>div]:bg-destructive' : ''}`} />
          {isNearLimit && (
            <div className="flex items-center text-destructive text-sm mt-3">
              <AlertCircle className="h-4 w-4 mr-2" />
              Approaching maximum capacity. Upgrade to ensure uninterrupted intelligence extraction.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { name: "Free", price: "0", limit: "10", id: "free", features: ["10 transmissions/mo", "Basic extraction", "3-day retention"] },
          { name: "Pro", price: "29", limit: "100", id: "pro", features: ["100 transmissions/mo", "Advanced analysis", "Priority queue", "30-day retention", "Webhook routing"] },
          { name: "Business", price: "79", limit: "500", id: "business", features: ["500 transmissions/mo", "Custom vocabularies", "CRM Integrations", "1-year retention"] },
          { name: "MSP", price: "199", limit: "2000", id: "msp", features: ["2000 transmissions/mo", "White-label reports", "Unlimited retention", "Dedicated support line"] }
        ].map((p) => {
          const isCurrent = planData.plan === p.id;
          return (
            <Card key={p.id} className={`flex flex-col bg-card ${isCurrent ? 'border-primary ring-1 ring-primary shadow-[0_0_15px_rgba(255,0,0,0.1)]' : ''}`}>
              <CardHeader>
                <CardTitle className="text-xl">{p.name}</CardTitle>
                <CardDescription>
                  <span className="text-3xl font-bold text-foreground">${p.price}</span>/mo
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3 text-sm text-muted-foreground">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start">
                      <Check className="h-4 w-4 text-primary mr-2 mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button 
                  className="w-full" 
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isCurrent}
                  onClick={() => handleSubscribe(p.id)}
                >
                  {isCurrent ? "Current Deployment" : "Deploy Upgrade"}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
