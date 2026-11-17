// FAFO's Terms of Service, word for word as the owner posted them in FAFO's Discord (FAFbotAPP, 2026-11-13), which a new
// user reads and accepts after Continue with Discord, before their key request goes to the owner (2026-11-17, the owner:
// "Before a key is issue, I want users to read the terms and conditions, accepts it then a key will be generated for them
// to use"). Discord's channel mentions are written "#news" and "#house-rules".
//
// When the owner changes the terms in Discord, change them here too and give them a new `version` (their effective date,
// YYYY-MM-DD): each acceptance keeps the version it was for. Only new users accept (the owner's choice): a new version
// doesn't ask anyone who already has a key or a request again.
export const TERMS = {
  version: "2026-11-13",
  effective: "November 13, 2026",
  title: "FAFO // TERMS OF SERVICE",
  short: "FAFO ACO tries to check out for you with the slots you submit. Nothing is guaranteed, fees are billed by invoice, sales are final, and your info is only used to place your orders. The full terms are below.",
  sections: [
    {
      n: "01", title: "The service",
      text: ["FAFO ACO runs automated checkouts at online retailers using the profiles (\"slots\") you submit through the FAFO app. We can't guarantee any checkout, stock, order outcome or resale value."],
    },
    {
      n: "02", title: "Your side of the deal",
      list: [
        "Your profiles are accurate, and the cards and accounts in them are yours or you're allowed to use them.",
        "You check your slots before submitting, and you're responsible for what you submit.",
        "You keep your FAFO license key and vault password private.",
      ],
    },
    {
      n: "03", title: "Fees and refunds",
      list: [
        "Fees and invoice due dates are posted in #news. Pay your invoices on time.",
        "All sales are final. We refund only billing mistakes or duplicate payments that we confirm.",
        "Prices can change, and changes are announced in #news first.",
      ],
    },
    {
      n: "04", title: "When things go wrong",
      text: ["Items sell out, orders get cancelled or declined, accounts get limited or banned, sites change and networks drop. FAFO ACO isn't responsible for any of that, or for wrong, unintended or duplicate orders, charges or fees caused by a profile mistake, a system or automation error, a retailer or a payment processor. You use the service at your own risk and agree not to hold FAFO ACO responsible for those purchases or charges. To the fullest extent the law allows, we aren't liable for indirect or consequential losses, such as lost profits or lost data."],
    },
    {
      n: "05", title: "Your data",
      list: [
        "The FAFO app encrypts your profiles, cards and logins on your own device.",
        "Submitted slots travel through Discord to a private channel that only the FAFO operator and authorized staff can see.",
        "Submitting lets us use what's in your slots, including personal details, cards and store accounts, to place the orders you submitted.",
        "You can withdraw a slot at any time by pulling it on the app's Submit page.",
      ],
    },
    {
      n: "06", title: "Access",
      text: ["We can suspend or end your access, including your FAFO license, at any time, for example if you break these terms or the #house-rules."],
    },
    {
      n: "07", title: "Changes",
      text: ["We may update these terms. The new version is posted here with a new date, and using FAFO after that means you accept it. Submitting slots means you agree to these terms in full."],
    },
  ],
  end: "Questions? Ask staff.",
};
