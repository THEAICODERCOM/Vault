require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getUser, db, transaction } = require('./database');
const { formatTime, calculateSuccess } = require('./utils');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'your_token_here') {
    console.error('❌ ERROR: DISCORD_TOKEN is missing or not set in .env');
}
if (!process.env.CLIENT_ID || process.env.CLIENT_ID === 'your_client_id_here') {
    console.error('❌ ERROR: CLIENT_ID is missing or not set in .env');
}

const commands = [
    // /balance
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your vault coins')
        .addUserOption(option => option.setName('user').setDescription('The user to check balance for').setRequired(false)),
    
    // /work
    new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work for some coins'),
    
    // /daily
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily reward'),
    
    // /give
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give coins to another user')
        .addUserOption(option => option.setName('user').setDescription('The user to give coins to').setRequired(true))
        .addIntegerOption(option => option.setName('amount').setDescription('Amount of coins').setRequired(true)),

    // /vault
    new SlashCommandBuilder()
        .setName('vault')
        .setDescription('View your vault status'),

    // /heist
    new SlashCommandBuilder()
        .setName('heist')
        .setDescription('Try to rob another user')
        .addUserOption(option => option.setName('user').setDescription('The user to rob').setRequired(true)),

    // /upgrade
    new SlashCommandBuilder()
        .setName('upgrade')
        .setDescription('Upgrade your vault capacity or security')
        .addStringOption(option => option.setName('type').setDescription('What to upgrade').setRequired(true).addChoices(
            { name: 'Capacity', value: 'capacity' },
             { name: 'Security', value: 'security' }
         )),

    // /business
    new SlashCommandBuilder()
        .setName('business')
        .setDescription('Manage your businesses')
        .addSubcommand(sub => sub.setName('buy').setDescription('Buy a business').addStringOption(opt => opt.setName('type').setDescription('Type of business').setRequired(true).addChoices(
            { name: 'Coffee Shop (50k)', value: 'coffee' },
            { name: 'Gold Mine (150k)', value: 'mine' }
        )))
        .addSubcommand(sub => sub.setName('collect').setDescription('Collect profits from your businesses'))
        .addSubcommand(sub => sub.setName('sabotage').setDescription('Sabotage someone else\'s business (Cost: 5k)')
            .addUserOption(opt => opt.setName('target').setDescription('The user to sabotage').setRequired(true))),

    // /faction
    new SlashCommandBuilder()
        .setName('faction')
        .setDescription('Manage your faction')
        .addSubcommand(sub => sub.setName('create').setDescription('Create a new faction (Cost: 10k)').addStringOption(opt => opt.setName('name').setDescription('Faction name').setRequired(true)))
        .addSubcommand(sub => sub.setName('join').setDescription('Join a faction').addStringOption(opt => opt.setName('name').setDescription('Faction name').setRequired(true)))
        .addSubcommand(sub => sub.setName('view').setDescription('View your faction'))
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim this channel for your faction (Cost: 25k)'))
        .addSubcommand(sub => sub.setName('collect').setDescription('Collect 2% interest from the faction vault (Once per 24h)')),

    // /shop
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse the item shop'),

    // /inventory
    new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your items'),

    // /leaderboard
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('See the richest players'),

    // /help
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get a guide on how to play and list of features'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        
        // GLOBAL DEPLOYMENT (Use this for production - works in all servers)
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const user = getUser(interaction.user.id);

    if (interaction.commandName === 'balance') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const dbUser = getUser(targetUser.id);
        const isInked = dbUser.ink_bomb_until > Date.now();
        
        const embed = new EmbedBuilder()
            .setTitle(`${targetUser.username}'s Balance ${isInked ? '🔴 (MARKED)' : ''}`)
            .addFields(
                { name: 'Vault', value: `🏦 ${dbUser.vault.toLocaleString()} / ${dbUser.vault_capacity.toLocaleString()}`, inline: true }
            )
            .setColor(isInked ? 'Red' : 'Gold');
        
        if (isInked) {
            embed.setFooter({ text: `This user is marked by an ink bomb! Ends in ${formatTime(dbUser.ink_bomb_until - Date.now())}` });
        }
        
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'work') {
        const now = Date.now();
        const cooldown = 5 * 60 * 1000; // 5 minutes
        if (now - user.last_work < cooldown) {
            const remaining = cooldown - (now - user.last_work);
            return interaction.reply({ content: `Chill out! You can work again in ${formatTime(remaining)}.`, ephemeral: true });
        }

        const reward = Math.floor(Math.random() * 200) + 50;
        
        // Check vault capacity before anything else
        const space = user.vault_capacity - user.vault;
        if (space <= 0) {
            return interaction.reply({ content: "Your vault is full! Upgrade your capacity to earn more coins.", ephemeral: true });
        }

        const territory = db.prepare('SELECT * FROM territory WHERE channel_id = ?').get(interaction.channelId);
        let tax = 0;
        if (territory && territory.faction_id !== user.faction_id) {
            tax = Math.floor(reward * 0.05);
            db.prepare('UPDATE factions SET vault = vault + ? WHERE id = ?').run(tax, territory.faction_id);
        }

        const finalReward = Math.min(reward - tax, space);
        
        db.prepare('UPDATE users SET vault = vault + ?, last_work = ? WHERE id = ?').run(finalReward, now, user.id);

        let msg = `You worked and earned 🪙 ${finalReward}!`;
        msg += ` (🏦 ${finalReward} auto-deposited)`;
        if (tax > 0) msg += ` (Paid 🪙 ${tax} tax to territory owners)`;
        await interaction.reply(msg);
    }

    if (interaction.commandName === 'daily') {
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000; // 24 hours
        if (now - user.last_daily < cooldown) {
            const remaining = cooldown - (now - user.last_daily);
            return interaction.reply({ content: `Come back in ${formatTime(remaining)} for more coins.`, ephemeral: true });
        }

        const reward = 1000;
        
        // Check vault capacity
        const space = user.vault_capacity - user.vault;
        if (space <= 0) {
            return interaction.reply({ content: "Your vault is full! Upgrade your capacity to claim your daily reward.", ephemeral: true });
        }

        const finalReward = Math.min(reward, space);

        db.prepare('UPDATE users SET vault = vault + ?, last_daily = ? WHERE id = ?').run(finalReward, now, user.id);

        let msg = `You claimed your daily reward of 🪙 ${finalReward}!`;
        msg += ` (🏦 ${finalReward} auto-deposited)`;
        await interaction.reply(msg);
    }

    if (interaction.commandName === 'give') {
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (amount <= 0) return interaction.reply({ content: 'Nice try, but no.', ephemeral: true });
        if (user.vault < amount) return interaction.reply({ content: "You're too broke for that.", ephemeral: true });
        if (targetUser.id === interaction.user.id) return interaction.reply({ content: "You can't give money to yourself, dummy.", ephemeral: true });

        const target = getUser(targetUser.id);
        
        // Check target vault capacity
        const targetSpace = target.vault_capacity - target.vault;
        if (targetSpace <= 0) return interaction.reply({ content: "That user's vault is full! They can't receive any more coins.", ephemeral: true });

        const finalAmount = Math.min(amount, targetSpace);

        transaction(() => {
            db.prepare('UPDATE users SET vault = vault - ? WHERE id = ?').run(amount, user.id);
            db.prepare('UPDATE users SET vault = vault + ? WHERE id = ?').run(finalAmount, target.id);
        });

        let msg = `You gave 🪙 ${finalAmount} to ${targetUser.username}.`;
        if (finalAmount < amount) msg += ` (Only ${finalAmount} was sent because their vault reached capacity!)`;
        await interaction.reply(msg);
    }

    if (interaction.commandName === 'vault') {
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Vault`)
            .addFields(
                { name: 'Balance', value: `🏦 ${user.vault.toLocaleString()} / ${user.vault_capacity.toLocaleString()}`, inline: true },
                { name: 'Security', value: `🛡️ Level ${user.security_level}`, inline: true }
            )
            .setColor('Blue');
        return interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'heist') {
        const targetUser = interaction.options.getUser('user');
        if (targetUser.id === interaction.user.id) return interaction.reply({ content: "Robbing yourself? Really?", ephemeral: true });

        const target = getUser(targetUser.id);
        if (target.vault <= 0) return interaction.reply({ content: "That person has nothing in their vault. Not worth it.", ephemeral: true });

        // 1. Check for Vault Shield
        const shield = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(target.id, 'shield');
        if (shield) {
            db.prepare('DELETE FROM inventory WHERE id = ?').run(shield.id);
            return interaction.reply(`❌ You were about to break in, but ${targetUser.username}'s **Vault Shield** activated and blocked you! The shield was destroyed.`);
        }

        // 2. Calculate Success
        const lockpick = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(user.id, 'lockpick');
        const attackerPower = lockpick ? 2 : 1;
        if (lockpick) db.prepare('DELETE FROM inventory WHERE id = ?').run(lockpick.id); // Use up the lockpick

        const success = calculateSuccess(attackerPower, target.security_level);

        if (success) {
            // 3. Check for False Bottom
            const falseBottom = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(target.id, 'false_bottom');
            if (falseBottom) {
                db.prepare('DELETE FROM inventory WHERE id = ?').run(falseBottom.id);
                return interaction.reply(`🕵️ You successfully cracked the vault of ${targetUser.username}... but it had a **False Bottom**! You found nothing but dust. The trap was destroyed.`);
            }

            const stolen = Math.floor(target.vault * (Math.random() * 0.5 + 0.1)); // Steal 10-60%
            
            // Check vault capacity
            const space = user.vault_capacity - user.vault;
            if (space <= 0) {
                return interaction.reply({ content: `🚨 **SUCCESS!** You broke into ${targetUser.username}'s vault, but your vault is full! You couldn't carry any coins back.`, ephemeral: true });
            }

            const finalStolen = Math.min(stolen, space);

            transaction(() => {
                db.prepare('UPDATE users SET vault = vault - ? WHERE id = ?').run(stolen, target.id);
                db.prepare('UPDATE users SET vault = vault + ? WHERE id = ?').run(finalStolen, user.id);
            });

            let msg = `🚨 **SUCCESS!** You broke into ${targetUser.username}'s vault and made off with 🪙 ${finalStolen}!`;
            msg += ` (🏦 ${finalStolen} auto-deposited)`;
            if (finalStolen < stolen) msg += ` (You had to leave some behind because your vault was full!)`;
            await interaction.reply(msg);
        } else {
            // 4. Handle Failure (Traps)
            let penaltyMsg = "";
            let finePercent = 0.2;

            const shockWire = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(target.id, 'shock_wire');
            if (shockWire) {
                db.prepare('DELETE FROM inventory WHERE id = ?').run(shockWire.id);
                finePercent = 0.5; // Heavy penalty
                penaltyMsg = " You were hit by a **Shock Wire** trap!";
            }

            const inkBomb = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(target.id, 'ink_bomb');
            if (inkBomb) {
                db.prepare('DELETE FROM inventory WHERE id = ?').run(inkBomb.id);
                const duration = 24 * 60 * 60 * 1000;
                db.prepare('UPDATE users SET ink_bomb_until = ? WHERE id = ?').run(Date.now() + duration, user.id);
                penaltyMsg += " An **Ink Bomb** exploded, marking you for 24 hours!";
            }

            const fine = Math.floor(user.vault * finePercent);
            db.prepare('UPDATE users SET vault = vault - ? WHERE id = ?').run(fine, user.id);
            await interaction.reply({ content: `❌ **FAILED!** You got caught trying to rob ${targetUser.username} and were fined 🪙 ${fine}.${penaltyMsg}` });
        }
    }

    if (interaction.commandName === 'upgrade') {
        const type = interaction.options.getString('type');
        
        if (type === 'capacity') {
            const cost = (user.vault_capacity / 5000) * 2000;
            if (user.vault < cost) return interaction.reply({ content: `You need 🪙 ${cost} in your vault to upgrade capacity.`, ephemeral: true });
            
            db.prepare('UPDATE users SET vault = vault - ?, vault_capacity = vault_capacity + 5000 WHERE id = ?').run(cost, user.id);
            await interaction.reply(`Upgraded vault capacity to ${user.vault_capacity + 5000}!`);
        }

        if (type === 'security') {
            const cost = user.security_level * 5000;
            if (user.vault < cost) return interaction.reply({ content: `You need 🪙 ${cost} in your vault to upgrade security.`, ephemeral: true });
            
            db.prepare('UPDATE users SET vault = vault - ?, security_level = security_level + 1 WHERE id = ?').run(cost, user.id);
             await interaction.reply(`Upgraded security to level ${user.security_level + 1}!`);
         }
     }

     if (interaction.commandName === 'business') {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'buy') {
            const type = interaction.options.getString('type');
            const businesses = {
                'coffee': { cost: 50000, income: 500, name: 'Coffee Shop' },
                'mine': { cost: 150000, income: 2000, name: 'Gold Mine' }
            };
            const biz = businesses[type];
            if (user.vault < biz.cost) return interaction.reply({ content: `You need 🪙 ${biz.cost} in your vault for that.`, ephemeral: true });

            db.prepare('INSERT INTO businesses (user_id, type, last_claim) VALUES (?, ?, ?)').run(user.id, type, Date.now());
            db.prepare('UPDATE users SET vault = vault - ? WHERE id = ?').run(biz.cost, user.id);
            await interaction.reply(`Bought a ${biz.name}!`);
        }

        if (subcommand === 'collect') {
            const userBizs = db.prepare('SELECT * FROM businesses WHERE user_id = ?').all(user.id);
            if (userBizs.length === 0) return interaction.reply({ content: "You don't own any businesses.", ephemeral: true });

            // Check vault capacity early
            const space = user.vault_capacity - user.vault;
            if (space <= 0) {
                return interaction.reply({ content: "Your vault is full! Upgrade your capacity to collect profits.", ephemeral: true });
            }

            const businesses = {
                'coffee': { income: 500 },
                'mine': { income: 2000 }
            };

            let totalProfit = 0;
            const now = Date.now();
            let sabotagedCount = 0;
            
            let responseMsg = '';
            let responseEphemeral = false;

            transaction(() => {
                for (const biz of userBizs) {
                    if (biz.sabotaged_until > now) {
                        sabotagedCount++;
                        continue;
                    }

                    const elapsedHours = (now - biz.last_claim) / (1000 * 60 * 60);
                    if (elapsedHours >= 1) {
                        const profit = Math.floor(elapsedHours) * businesses[biz.type].income;
                        totalProfit += profit;
                        db.prepare('UPDATE businesses SET last_claim = ? WHERE id = ?').run(now, biz.id);
                    }
                }
                if (totalProfit > 0) {
                    // Check vault capacity
                    const space = user.vault_capacity - user.vault;
                    if (space <= 0) {
                        responseMsg = "Your vault is full! Upgrade your capacity to collect profits.";
                        responseEphemeral = true;
                    } else {
                        const finalProfit = Math.min(totalProfit, space);
                        db.prepare('UPDATE users SET vault = vault + ? WHERE id = ?').run(finalProfit, user.id);
                        
                        responseMsg = `Collected 🪙 ${finalProfit} in profit!`;
                        responseMsg += ` (🏦 ${finalProfit} auto-deposited)`;
                        if (sabotagedCount > 0) responseMsg += ` (${sabotagedCount} businesses are currently sabotaged and produced nothing)`;
                        if (finalProfit < totalProfit) responseMsg += ` (Vault reached capacity; some profit was lost!)`;
                    }
                } else if (sabotagedCount > 0) {
                    responseMsg = `All your businesses are currently sabotaged! They will be back online soon.`;
                    responseEphemeral = true;
                } else {
                    responseMsg = "Nothing to collect yet. Wait at least an hour.";
                    responseEphemeral = true;
                }
            });

            await interaction.reply({ content: responseMsg, ephemeral: responseEphemeral });
        }

         if (subcommand === 'sabotage') {
            const targetUser = interaction.options.getUser('target');
            if (targetUser.id === interaction.user.id) return interaction.reply({ content: "Sabotaging yourself? That's a new level of self-harm.", ephemeral: true });

            if (user.vault < 5000) return interaction.reply({ content: "Sabotaging costs 🪙 5,000 from your vault.", ephemeral: true });

            const targetBizs = db.prepare('SELECT * FROM businesses WHERE user_id = ?').all(targetUser.id);
            if (targetBizs.length === 0) return interaction.reply({ content: "That user doesn't have any businesses to sabotage.", ephemeral: true });

            const guard = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_id = ? LIMIT 1').get(targetUser.id, 'guard');

            if (guard) {
                transaction(() => {
                    db.prepare('DELETE FROM inventory WHERE id = ?').run(guard.id);
                    db.prepare('UPDATE users SET vault = vault - 5000 WHERE id = ?').run(user.id);
                });
                return interaction.reply(`❌ Your sabotage attempt on ${targetUser.username} failed! Their **Security Guard** stopped you and was consumed in the process.`);
            }

            const bizToSabotage = targetBizs[Math.floor(Math.random() * targetBizs.length)];
            const duration = 6 * 60 * 60 * 1000; // 6 hours

            transaction(() => {
                db.prepare('UPDATE businesses SET sabotaged_until = ? WHERE id = ?').run(Date.now() + duration, bizToSabotage.id);
                db.prepare('UPDATE users SET vault = vault - 5000 WHERE id = ?').run(user.id);
            });

            await interaction.reply(`🕵️ Successfully sabotaged one of ${targetUser.username}'s businesses for 6 hours!`);
         }
      }

      if (interaction.commandName === 'faction') {
        const subcommand = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');

        if (subcommand === 'create') {
            if (user.faction_id) return interaction.reply({ content: "You're already in a faction.", ephemeral: true });
            if (user.vault < 10000) return interaction.reply({ content: "Creating a faction costs 🪙 10,000 from your vault.", ephemeral: true });

            try {
                db.prepare('INSERT INTO factions (id, name, owner_id) VALUES (?, ?, ?)').run(name.toLowerCase(), name, user.id);
                db.prepare('UPDATE users SET faction_id = ?, vault = vault - 10000 WHERE id = ?').run(name.toLowerCase(), user.id);
                await interaction.reply(`Faction **${name}** created!`);
            } catch (e) {
                await interaction.reply({ content: "A faction with that name already exists.", ephemeral: true });
            }
        }

        if (subcommand === 'join') {
            if (user.faction_id) return interaction.reply({ content: "You're already in a faction.", ephemeral: true });
            const faction = db.prepare('SELECT * FROM factions WHERE id = ?').get(name.toLowerCase());
            if (!faction) return interaction.reply({ content: "Faction not found.", ephemeral: true });

            db.prepare('UPDATE users SET faction_id = ? WHERE id = ?').run(faction.id, user.id);
            await interaction.reply(`Joined **${faction.name}**!`);
        }

        if (subcommand === 'view') {
            if (!user.faction_id) return interaction.reply({ content: "You're not in a faction.", ephemeral: true });
            const faction = db.prepare('SELECT * FROM factions WHERE id = ?').get(user.faction_id);
            const members = db.prepare('SELECT COUNT(*) as count FROM users WHERE faction_id = ?').get(faction.id);
            const territory = db.prepare('SELECT COUNT(*) as count FROM territory WHERE faction_id = ?').get(faction.id);

            const embed = new EmbedBuilder()
                .setTitle(`Faction: ${faction.name}`)
                .addFields(
                    { name: 'Owner', value: `<@${faction.owner_id}>`, inline: true },
                    { name: 'Members', value: `${members.count}`, inline: true },
                    { name: 'Faction Vault', value: `🪙 ${faction.vault}`, inline: true },
                    { name: 'Territories', value: `${territory.count} channels`, inline: true }
                )
                .setColor('Purple');
            await interaction.reply({ embeds: [embed] });
         }

         if (subcommand === 'claim') {
            if (!user.faction_id) return interaction.reply({ content: "You need to be in a faction to claim territory.", ephemeral: true });
            const faction = db.prepare('SELECT * FROM factions WHERE id = ?').get(user.faction_id);
            if (faction.owner_id !== user.id) return interaction.reply({ content: "Only the faction owner can claim territory.", ephemeral: true });
            
            const cost = 25000;
            if (user.vault < cost) return interaction.reply({ content: `Claiming a channel costs 🪙 ${cost} from your vault.`, ephemeral: true });

            const currentOwner = db.prepare('SELECT * FROM territory WHERE channel_id = ?').get(interaction.channelId);
            if (currentOwner && currentOwner.faction_id === faction.id) return interaction.reply({ content: "Your faction already owns this channel!", ephemeral: true });

            transaction(() => {
                db.prepare('INSERT OR REPLACE INTO territory (channel_id, faction_id) VALUES (?, ?)').run(interaction.channelId, faction.id);
                db.prepare('UPDATE users SET vault = vault - ? WHERE id = ?').run(cost, user.id);
            });
            await interaction.reply(`🚩 This channel is now territory of **${faction.name}**! They will take a 5% tax from all work done here.`);
         }

         if (subcommand === 'collect') {
            if (!user.faction_id) return interaction.reply({ content: "You're not in a faction.", ephemeral: true });
            const faction = db.prepare('SELECT * FROM factions WHERE id = ?').get(user.faction_id);
            if (faction.owner_id !== user.id) return interaction.reply({ content: "Only the faction owner can collect vault interest.", ephemeral: true });

            const now = Date.now();
            const lastInterest = faction.last_interest || 0;
            const cooldown = 24 * 60 * 60 * 1000;

            if (now - lastInterest < cooldown) {
                return interaction.reply({ content: `You can only collect vault interest once every 24 hours. Next collection in ${formatTime(cooldown - (now - lastInterest))}.`, ephemeral: true });
            }

            const interest = Math.floor(faction.vault * 0.02);
            if (interest <= 0) return interaction.reply({ content: "The faction vault is empty or too low to generate interest.", ephemeral: true });

            // Check vault capacity
            const space = user.vault_capacity - user.vault;
            if (space <= 0) return interaction.reply({ content: "Your vault is full! Upgrade your capacity to collect faction interest.", ephemeral: true });

            const finalInterest = Math.min(interest, space);

            transaction(() => {
                db.prepare('UPDATE factions SET vault = vault - ?, last_interest = ? WHERE id = ?').run(interest, now, faction.id);
                db.prepare('UPDATE users SET vault = vault + ? WHERE id = ?').run(finalInterest, user.id);
            });

            let msg = `You collected 🪙 ${finalInterest} interest from the faction vault!`;
            msg += ` (🏦 ${finalInterest} auto-deposited)`;
            if (finalInterest < interest) msg += ` (Vault reached capacity; some interest was lost!)`;
            await interaction.reply(msg);
         }
        }

       if (interaction.commandName === 'shop') {
            const items = [
                { id: 'lockpick', name: 'Lockpick', cost: 1000, desc: 'Slightly better heist chance' },
                { id: 'shield', name: 'Vault Shield', cost: 5000, desc: 'Protects against one heist' },
                { id: 'ink_bomb', name: 'Ink Bomb', cost: 2500, desc: 'Marks attackers red on fail' },
                { id: 'shock_wire', name: 'Shock Wire', cost: 4000, desc: 'Large failure penalty for attackers' },
                { id: 'false_bottom', name: 'False Bottom', cost: 7500, desc: 'Heist succeeds but yields 0 coins' },
                { id: 'guard', name: 'Security Guard', cost: 10000, desc: 'Prevents business sabotage' }
            ];

            const embed = new EmbedBuilder()
                .setTitle('🛒 Item Shop')
                .setDescription('Select an item to view details and buy.')
                .setColor('Green');
            
            items.forEach(i => embed.addFields({ name: `${i.name} (🪙 ${i.cost})`, value: i.desc }));

            const select = new StringSelectMenuBuilder()
                .setCustomId('shop_select')
                .setPlaceholder('Pick an item')
                .addOptions(items.map(i => ({ label: i.name, value: i.id, description: `🪙 ${i.cost}` })));

            const row = new ActionRowBuilder().addComponents(select);
            await interaction.reply({ embeds: [embed], components: [row] });
       }

       if (interaction.commandName === 'inventory') {
            const inv = db.prepare('SELECT item_id, COUNT(*) as count FROM inventory WHERE user_id = ? GROUP BY item_id').all(user.id);
            if (inv.length === 0) return interaction.reply({ content: "Your inventory is empty.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle(`🎒 ${interaction.user.username}'s Inventory`)
                .setDescription(inv.map(i => `• **${i.item_id.replace('_', ' ').toUpperCase()}** x${i.count}`).join('\n'))
                .setColor('Grey');
            await interaction.reply({ embeds: [embed] });
       }

    if (interaction.commandName === 'leaderboard') {
        // Defer reply because fetching users can be slow
        await interaction.deferReply();
        
        const topUsers = db.prepare('SELECT id, vault FROM users ORDER BY vault DESC LIMIT 10').all();
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 Global Wealth Leaderboard')
            .setColor('Gold');

        const leaderboardList = await Promise.all(topUsers.map(async (u, index) => {
            let username = 'Unknown';
            try {
                const discordUser = await client.users.fetch(u.id);
                username = discordUser.username;
            } catch (e) {
                username = `User(${u.id.substring(0, 5)}...)`;
            }
            return `${index + 1}. **${username}** - 🏦 ${u.vault.toLocaleString()}`;
        }));

        embed.setDescription(leaderboardList.join('\n') || 'No players yet.');
        await interaction.editReply({ embeds: [embed] });
    }

    if (interaction.commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ VaultQuest: Survival Guide')
                .setDescription('Welcome to VaultQuest, a game of risk, strategy, and wealth.')
                .addFields(
                    { name: '💰 Economy', value: '`/balance`, `/work`, `/daily`, `/give`, `/leaderboard`' },
                    { name: '🏦 Vaults & Upgrades', value: '`/vault`, `/upgrade capacity/security`' },
                    { name: '🚨 Heists & Items', value: '`/heist`, `/shop`, `/inventory`' },
                    { name: '🏢 Businesses', value: '`/business buy/collect/sabotage`' },
                    { name: '🚩 Factions & Territory', value: '`/faction create/join/view/claim/collect`' },
                    { name: '❓ Support', value: 'Use `/help` to see this message again.' }
                )
                .setFooter({ text: 'Strategy Tip: If your vault is full, you cannot earn more coins. Upgrade your capacity!' })
                .setColor('Blue');
            
            await interaction.reply({ embeds: [embed] });
       }
   });

   client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_select') {
        const itemId = interaction.values[0];
        const items = {
            'lockpick': { name: 'Lockpick', cost: 1000, desc: 'Slightly better heist chance' },
            'shield': { name: 'Vault Shield', cost: 5000, desc: 'Protects against one heist' },
            'ink_bomb': { name: 'Ink Bomb', cost: 2500, desc: 'Marks attackers red on fail' },
            'shock_wire': { name: 'Shock Wire', cost: 4000, desc: 'Large failure penalty for attackers' },
            'false_bottom': { name: 'False Bottom', cost: 7500, desc: 'Heist succeeds but yields 0 coins' },
            'guard': { name: 'Security Guard', cost: 10000, desc: 'Prevents business sabotage' }
        };
        const item = items[itemId];
        
        const embed = new EmbedBuilder()
            .setTitle(`Confirm Purchase: ${item.name}`)
            .setDescription(`${item.desc}\n\n**Cost:** 🪙 ${item.cost}`)
            .setColor('Blue');

        const confirm = new ButtonBuilder()
            .setCustomId(`buy_confirm_${itemId}`)
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success);

        const cancel = new ButtonBuilder()
            .setCustomId('buy_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(confirm, cancel);

        await interaction.update({ embeds: [embed], components: [row] });
    }

    if (interaction.isButton()) {
        if (interaction.customId.startsWith('buy_confirm_')) {
            const itemId = interaction.customId.replace('buy_confirm_', '');
            const items = {
                'lockpick': { name: 'Lockpick', cost: 1000 },
                'shield': { name: 'Vault Shield', cost: 5000 },
                'ink_bomb': { name: 'Ink Bomb', cost: 2500 },
                'shock_wire': { name: 'Shock Wire', cost: 4000 },
                'false_bottom': { name: 'False Bottom', cost: 7500 },
                'guard': { name: 'Security Guard', cost: 10000 }
            };
            const item = items[itemId];
            const user = getUser(interaction.user.id);

            if (user.vault < item.cost) return interaction.update({ content: "❌ Broke boy alert. You can't afford that.", embeds: [], components: [] });

            transaction(() => {
                db.prepare('UPDATE users SET vault = vault - ? WHERE id = ?').run(item.cost, user.id);
                db.prepare('INSERT INTO inventory (user_id, item_id) VALUES (?, ?)').run(user.id, itemId);
            });

            await interaction.update({ content: `✅ Successfully bought **${item.name}**!`, embeds: [], components: [] });
        }

        if (interaction.customId === 'buy_cancel') {
            await interaction.update({ content: 'Purchase cancelled.', embeds: [], components: [] });
        }
    }
   });

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log('🤖 Bot is online and ready to serve.');
});

client.login(process.env.DISCORD_TOKEN);
