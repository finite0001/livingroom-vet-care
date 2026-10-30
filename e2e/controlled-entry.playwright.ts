import {test,expect,type Page}from"@playwright/test";
test.use({timezoneId:"UTC"});
const route="/tests/controlled-drugs/controlled-entry-fixture.html";
async function plan(page:Page){
 await page.getByRole("button",{name:"Record original adjustment",exact:true}).click();
 await expect(page.getByRole("dialog")).toBeVisible();
 await expect(page.getByLabel("Actual physical observation time")).toHaveValue("");
 await page.getByLabel("Actual physical observation time").fill("2026-10-24T15:21:52");
 await page.getByLabel("UTC offset at that time").selectOption("+00:00");
 await page.getByLabel("Stock-record note").fill("Synthetic explicit physical allocation; not a practice observation");
 await page.getByLabel("Existing physical container").selectOption({label:"Synthetic stock bottle · stock · onsite"});
 await page.getByRole("button",{name:"Add selected container",exact:true}).click();
 await page.getByLabel("Actual custody result").selectOption("preserve");
 await page.getByRole("button",{name:"Add allocation",exact:true}).click();
 await page.getByRole("combobox",{name:"Original effect",exact:true}).selectOption("0");
 await page.getByLabel("Signed quantity (tablet)").fill("-1");
 await page.getByRole("button",{name:"Prepare for review",exact:true}).click();
 await expect(page.getByRole("heading",{name:"Review the prepared entry",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Record reviewed entry",exact:true})).toBeDisabled();
 await expect(page.getByRole("heading",{name:"Synthetic medication",exact:true})).toBeVisible();
 await expect(page.getByRole("region",{name:"Complete stock allocations",exact:true})).toContainText("Change -1 tablet");
 await expect(page.getByRole("region",{name:"Complete stock allocations",exact:true})).toContainText("Before");
 await expect(page.getByRole("region",{name:"Complete stock allocations",exact:true})).toContainText("After this action");
 await expect(page.locator("#calls")).not.toContainText("execute_managed_stock_intent_v1");
}
async function execute(page:Page){await page.getByRole("checkbox",{name:/I reviewed the original action/}).check();await page.getByRole("button",{name:"Record reviewed entry",exact:true}).click();}
test("mounted provider requires explicit allocations and later review, then records once",async({page})=>{
 await page.goto(route);await plan(page);await execute(page);await expect(page.locator("#result")).toHaveText("Recorded original action");
 const calls=(await page.locator("#calls").textContent())!.split("\n");expect(calls).toEqual(["probe_controlled_stock_intent_v1","read_managed_stock_intent_v1","prepare_managed_stock_intent_v1","execute_managed_stock_intent_v1"]);
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("lrv:controlled-stock-entry:")))).toEqual([]);
});
test("lost saved response retains IDs and explicit check recovers without reprepare/resend",async({page})=>{
 await page.goto(route+"?lost");await plan(page);await execute(page);await expect(page.getByRole("button",{name:"Check original entry",exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>Object.values(localStorage).every(value=>!value.includes("Synthetic")&&!value.includes("quantity")))).toBe(true);
 await page.getByRole("button",{name:"Check original entry",exact:true}).click();await expect(page.getByText("The original controlled-stock entry is recorded. Review the original action and verify its complete result before completing recovery; its IDs remain.",{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("lrv:controlled-stock-entry:")).length)).toBe(1);
 await page.getByRole("checkbox",{name:/I reviewed this recorded original action/}).check();await page.getByRole("button",{name:"Verify result and complete recovery",exact:true}).click();await expect(page.getByText("The original saved result is admitted. Its recovery IDs are cleared.",{exact:true})).toBeVisible();
 const calls=(await page.locator("#calls").textContent())!.split("\n");expect(calls.filter(x=>x==="prepare_managed_stock_intent_v1")).toHaveLength(1);expect(calls.filter(x=>x==="execute_managed_stock_intent_v1")).toHaveLength(1);expect(calls.at(-1)).toBe("read_managed_stock_intent_v1");
});
test("callback failure after save cannot spoof cancellation or clear the managed pointer",async({page})=>{
 await page.goto(route+"?callback");await plan(page);await execute(page);await expect(page.locator("#result")).toContainText("recorded, but this view could not admit");await expect(page.getByRole("button",{name:"Check original entry",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Check original entry",exact:true}).click();
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("lrv:controlled-stock-entry:")).length)).toBe(1);
});
test("new session for same actor masks planning and an old async caller cannot send",async({page})=>{
 await page.goto(route);await page.getByRole("button",{name:"Stage an old-session action",exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event("fixture-new-session")));await page.getByRole("button",{name:"Continue staged action",exact:true}).click();await expect(page.locator("#result")).toContainText("unavailable");await expect(page.locator("#calls")).toBeEmpty();
 await page.getByRole("button",{name:"Record original adjustment",exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();await page.getByLabel("Stock-record note").fill("Prior-session sensitive draft");await page.evaluate(()=>window.dispatchEvent(new Event("fixture-new-session")));await expect(page.getByRole("dialog")).not.toBeVisible();await expect(page.getByText("Prior-session sensitive draft")).not.toBeVisible();await expect(page.locator("#calls")).not.toContainText("prepare_managed_stock_intent_v1");
});
test("phone viewport remains operable through the explicit plan and review flow",async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(route);await plan(page);await expect(page.getByRole("button",{name:"Record reviewed entry",exact:true})).toBeVisible();await execute(page);await expect(page.locator("#result")).toHaveText("Recorded original action");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("independent-witness requirement has no none-witness fallback or direct canonical write",async({page})=>{
 await page.goto(route+"?witness");await plan(page);await page.getByRole("checkbox",{name:/I reviewed the original action/}).check();
 await expect(page.getByRole("button",{name:"Record reviewed entry",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Check independent witness",exact:true}).click();
 await expect(page.getByText("An eligible independent attestation has not been confirmed.",{exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Record reviewed entry",exact:true})).toBeDisabled();
 await expect(page.locator("#calls")).toContainText("read_managed_stock_witness_status_v1");await expect(page.locator("#calls")).not.toContainText("execute_managed_stock_intent_v1");
});
