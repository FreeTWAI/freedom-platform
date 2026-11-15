const id='12345678-1234-4234-8234-123456789abc';
export const acceptedPortalReturns=[
 '#home', '#account', '#explore/resources', '#me/settings?view=connections',
 `#shares/${id}?via=abcdefghij`, `#events/${id}?ref=abcdefghijklmnop`,
 `#explore/events/${id}?ref=abcdefghijklmnop`, '#guilds/guild_ai_vibe/tools/work',
 '#automation/connections', '#explore?q=hello%20world', '#community-hub', '#workbench/'+id, '#squad-outcomes/'+id,
 '#explore/resources?via='+'a'.repeat(511-'#explore/resources?via='.length),
] as const;
export const refusedPortalReturns=[
 'https://attacker.invalid/#home', '//attacker.invalid/#home', '/\\attacker.invalid/#home',
 '#home\n', '#home%0a', '#home?next=https://attacker.invalid', '#home?next=//attacker.invalid',
 '#home?next=javascript:alert(1)', '#home?next=https:attacker.invalid', '#home?next=%6a%61vascript%3Aalert', '#home?next=data%3Atext%2Fhtml',
 '#unknown', '#explore/not-a-place', '#automation/not-a-place', '#me/not-a-place',
 '#shares/not-an-id', '#events/------------------------------------?ref=abcdefghijklmnop', '#guilds/not-a-guild/tools/work', '#join/unknown',
 `#events/${id}?participation=abcdefghijklmnop`, '#home?'+'x'.repeat(512),
] as const;
