const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time, loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("Stake", function () {
    async function deployContractsFixture() {
        const [owner, admin, user1, user2] = await ethers.getSigners();

        // 部署奖励代币
        const RewardToken = await ethers.getContractFactory("ERC20Mock");
        const rewardToken = await RewardToken.deploy("Reward Token", "RWD", owner.address, ethers.parseEther("1000000"));

        // 部署质押代币 (用于测试的ERC20池)
        const StakingToken = await ethers.getContractFactory("ERC20Mock");
        const stakingToken = await StakingToken.deploy("Staking Token", "STK", owner.address, ethers.parseEther("1000000"));

        // 部署合约
        const Stake = await ethers.getContractFactory("Stake");
        const startBlock = (await ethers.provider.getBlockNumber()) + 10;
        const endBlock = startBlock + 10000;
        const rewardTokenPerBlock = ethers.parseEther("1");

        const stake = await upgrades.deployProxy(
            Stake,
            [rewardToken.target, startBlock, endBlock, rewardTokenPerBlock],
            { initializer: "initialize" }
        );

        // 授权admin角色
        await stake.grantRole(await stake.ADMIN_ROLE(), admin.address);
        await stake.grantRole(await stake.UPGRADE_ROLE(), admin.address);

        // 转移一些奖励代币到合约
        await rewardToken.transfer(stake.target, ethers.parseEther("50000"));

        // 为用户分配代币
        await rewardToken.transfer(user1.address, ethers.parseEther("1000"));
        await rewardToken.transfer(user2.address, ethers.parseEther("1000"));
        await stakingToken.transfer(user1.address, ethers.parseEther("1000"));
        await stakingToken.transfer(user2.address, ethers.parseEther("1000"));

        return {
            stake,
            rewardToken,
            stakingToken,
            owner,
            admin,
            user1,
            user2,
            startBlock,
            endBlock,
            rewardTokenPerBlock,
        };
    }

    describe("部署和初始化", function () {
        it("应该正确初始化", async function () {
            const { stake, rewardToken, startBlock, endBlock, rewardTokenPerBlock } = await loadFixture(deployContractsFixture);

            expect(await stake.RewardToken()).to.equal(rewardToken.target);
            expect(await stake.startBlock()).to.equal(startBlock);
            expect(await stake.endBlock()).to.equal(endBlock);
            expect(await stake.rewardTokenPerBlock()).to.equal(rewardTokenPerBlock);
            expect(await stake.totalPoolsWeight()).to.equal(0);
        });

        it("应该设置正确的角色", async function () {
            const { stake, owner, admin } = await loadFixture(deployContractsFixture);

            expect(await stake.hasRole(await stake.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await stake.hasRole(await stake.ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await stake.hasRole(await stake.UPGRADE_ROLE(), owner.address)).to.be.true;
            expect(await stake.hasRole(await stake.ADMIN_ROLE(), admin.address)).to.be.true;
        });
    });

    describe("池管理", function () {
        it("应该添加ETH池", async function () {
            const { stake, admin } = await loadFixture(deployContractsFixture);

            await expect(stake.connect(admin).addPool(
                ethers.ZeroAddress, // ETH池地址为0
                100,
                ethers.parseEther("0.1"),
                100,
                false
            ))
                .to.emit(stake, "AddPool")
                .withArgs(ethers.ZeroAddress, 100, anyValue, ethers.parseEther("0.1"), 100);

            const pool = await stake.pools(0);
            expect(pool.stTokenAddress).to.equal(ethers.ZeroAddress);
            expect(pool.poolWeight).to.equal(100);
            expect(pool.minDepositAmount).to.equal(ethers.parseEther("0.1"));
            expect(pool.unstakeLockedBlocks).to.equal(100);
            expect(await stake.totalPoolsWeight()).to.equal(100);
        });

        it("应该第一个添加ERC20池失败", async function () {
            const { stake, admin, stakingToken } = await loadFixture(deployContractsFixture);

            // 添加ERC20池
            await expect(stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                false
            )).revertedWith("First pool must to be ETH");
        });

        it("应该添加ERC20池", async function () {
            const { stake, admin, stakingToken } = await loadFixture(deployContractsFixture);

            // 先添加ETH池
            await expect(stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            ))
                .to.emit(stake, "AddPool")
                .withArgs(ethers.ZeroAddress, 100, anyValue, ethers.parseEther("0.1"), 100);

            // 添加ERC20池
            await expect(stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                false
            ))
                .to.emit(stake, "AddPool")
                .withArgs(stakingToken.target, 200, anyValue, ethers.parseEther("10"), 200);

            const pool = await stake.pools(1);
            expect(pool.stTokenAddress).to.equal(stakingToken.target);
            expect(pool.poolWeight).to.equal(200);
            expect(pool.minDepositAmount).to.equal(ethers.parseEther("10"));
            expect(pool.unstakeLockedBlocks).to.equal(200);
            expect(await stake.totalPoolsWeight()).to.equal(300);
        });

        it("应该非第一个添加ETH池失败", async function () {
            const { stake, admin, stakingToken } = await loadFixture(deployContractsFixture);

            // 先添加ETH池
            await expect(stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            ))
                .to.emit(stake, "AddPool")
                .withArgs(ethers.ZeroAddress, 100, anyValue, ethers.parseEther("0.1"), 100);

            // 添加ERC20池
            await expect(stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                false
            ))
                .to.emit(stake, "AddPool")
                .withArgs(stakingToken.target, 200, anyValue, ethers.parseEther("10"), 200);

            // 再添加ETH池
            await expect(stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            )).revertedWith("No first pool must not to be ETH");
        });

        it("应该更新池信息", async function () {
            const { stake, admin } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            await expect(stake.connect(admin).updatePool(
                0,
                ethers.parseEther("0.5"),
                150
            ))
                .to.emit(stake, "UpdatePool")
                .withArgs(0, ethers.parseEther("0.5"), 150);

            const pool = await stake.pools(0);
            expect(pool.minDepositAmount).to.equal(ethers.parseEther("0.5"));
            expect(pool.unstakeLockedBlocks).to.equal(150);
        });

        it("应该设置池权重", async function () {
            const { stake, admin } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            await expect(stake.connect(admin).setPoolWeight(0, 150, false))
                .to.emit(stake, "SetPoolWeight")
                .withArgs(0, 150, 150);

            const pool = await stake.pools(0);
            expect(pool.poolWeight).to.equal(150);
            expect(await stake.totalPoolsWeight()).to.equal(150);
        });
    });

    describe("ETH质押", function () {
        it("应该成功质押ETH", async function () {
            const { stake, user1 } = await loadFixture(deployContractsFixture);
            const [admin] = await ethers.getSigners();

            // 添加ETH池
            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            const depositAmount = ethers.parseEther("1");
            await expect(stake.connect(user1).depositETH({ value: depositAmount }))
                .to.emit(stake, "Deposit")
                .withArgs(0, user1.address, depositAmount);

            const userInfo = await stake.users(0, user1.address);
            expect(userInfo.stAmount).to.equal(depositAmount);

            const pool = await stake.pools(0);
            expect(pool.stTokenAmount).to.equal(depositAmount);
        });

        it("应该拒绝低于最小金额的ETH质押", async function () {
            const { stake, user1 } = await loadFixture(deployContractsFixture);
            const [admin] = await ethers.getSigners();

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            const smallAmount = ethers.parseEther("0.05");
            await expect(stake.connect(user1).depositETH({ value: smallAmount }))
                .to.be.revertedWith("deposit amount is too small");
        });
    });

    describe("ERC20质押", function () {
        it("应该成功质押ERC20", async function () {
            const { stake, admin, user1, stakingToken } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                true
            );

            // 添加ERC20池
            await stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                false
            );

            const depositAmount = ethers.parseEther("50");

            // 授权合约使用代币
            await stakingToken.connect(user1).approve(stake.target, depositAmount);

            await expect(stake.connect(user1).deposit(1, depositAmount))
                .to.emit(stake, "Deposit")
                .withArgs(1, user1.address, depositAmount);

            const userInfo = await stake.users(1, user1.address);
            expect(userInfo.stAmount).to.equal(depositAmount);

            const pool = await stake.pools(1);
            expect(pool.stTokenAmount).to.equal(depositAmount);
        });

        it("应该拒绝低于最小金额的ERC20质押", async function () {
            const { stake, admin, user1, stakingToken } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                true
            );

            // 添加ERC20池
            await stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                false
            );

            const depositAmount = ethers.parseEther("5");

            // 授权合约使用代币
            await stakingToken.connect(user1).approve(stake.target, depositAmount);

            await expect(stake.connect(user1).deposit(1, depositAmount))
                .to.be.revertedWith("deposit amount is too small");
        });
    });

    describe("奖励计算", function () {
        it("应该正确计算待领取奖励0", async function () {
            const { stake, admin, user1, stakingToken } = await loadFixture(deployContractsFixture);

            // 添加两个池
            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                true
            );

            await stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                true
            );

            // 检查待领取奖励
            const pendingRewardETH = await stake.getPendingRewardToken(0, user1.address);
            const pendingRewardERC20 = await stake.getPendingRewardToken(1, user1.address);

            // console.log("pendingRewardETH: ", ethers.formatEther(pendingRewardETH));
            // console.log("pendingRewardERC20: ", ethers.formatEther(pendingRewardERC20));
            expect(pendingRewardETH).to.be.eq(0);
            expect(pendingRewardERC20).to.be.eq(0);
        });

        // TODO: 金额为完全验证
        it("应该正确计算待领取奖励", async function () {
            const { stake, admin, user1, stakingToken, startBlock, endBlock, rewardTokenPerBlock } = await loadFixture(deployContractsFixture);

            let blockNumber = await ethers.provider.getBlockNumber();
            console.log("添加第一个池前区块号:", blockNumber);
            // 添加两个池
            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                true
            );
            blockNumber = await ethers.provider.getBlockNumber();
            console.log("添加第一个池后区块号:", blockNumber);

            await stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                true
            );

            let depositETHBlockNumber = await ethers.provider.getBlockNumber();
            console.log("质押ETH时区块号:", depositETHBlockNumber);
            // 质押ETH
            const ethDeposit = ethers.parseEther("1");
            await stake.connect(user1).depositETH({ value: ethDeposit });

            let depositERC20BlockNumber = await ethers.provider.getBlockNumber();
            console.log("质押ETH后区块号:", depositERC20BlockNumber);

            // 质押ERC20
            const erc20Deposit = ethers.parseEther("100");
            await stakingToken.connect(user1).approve(stake.target, erc20Deposit);
            await stake.connect(user1).deposit(1, erc20Deposit);

            blockNumber = await ethers.provider.getBlockNumber();
            console.log("质押ERC20后区块号:", blockNumber);

            // 推进区块以产生奖励
            // await ethers.provider.send("evm_increaseTime", [3600]); // 增加1小时
            // await ethers.provider.send("evm_mine", []);

            blockNumber = await ethers.provider.getBlockNumber();
            console.log("推进前区块号:", blockNumber);
            // 推进固定区块
            await mine(10);
            blockNumber = await ethers.provider.getBlockNumber();
            console.log("推进后区块号:", blockNumber);

            // 检查待领取奖励
            // const pendingRewardETH = await stake.getPendingRewardToken(0, user1.address);
            // const pendingRewardERC20 = await stake.getPendingRewardToken(1, user1.address);
            const [pendingRewardETH, pendingRewardERC20] = await Promise.all([
                stake.getPendingRewardToken(0, user1.address),
                stake.getPendingRewardToken(1, user1.address)
            ]);


            // 每区块 ethers.parseEther("1000000")
            // 池1权重100，池2权重200，总权重300
            console.log("pendingRewardETH: ", ethers.formatEther(pendingRewardETH));
            console.log("pendingRewardERC20: ", ethers.formatEther(pendingRewardERC20));
            expect(pendingRewardETH).to.be.gt(0);
            expect(pendingRewardERC20).to.be.gt(0);
        });
    });

    describe("解除质押和提现", function () {
        it("应该成功解除质押ETH并提现", async function () {
            const { stake, admin, user1 } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                10, // 锁定10个区块
                false
            );

            const depositAmount = ethers.parseEther("1");
            await stake.connect(user1).depositETH({ value: depositAmount });

            const unstakeAmount = ethers.parseEther("0.5");
            await expect(stake.connect(user1).unstake(0, unstakeAmount))
                .to.emit(stake, "Unstake")
                .withArgs(0, user1.address, unstakeAmount);

            // 检查用户质押余额
            const userInfo = await stake.users(0, user1.address);
            expect(userInfo.stAmount).to.equal(ethers.parseEther("0.5"));

            // 推进区块超过锁定时间
            for (let i = 0; i < 15; i++) {
                await ethers.provider.send("evm_mine", []);
            }

            // 提现
            const beforeBalance = await ethers.provider.getBalance(user1.address);
            console.log("beforeBalance: ", ethers.formatEther(beforeBalance));
            await expect(stake.connect(user1).withdraw(0))
                .to.emit(stake, "Withdraw")
                .withArgs(0, user1.address, unstakeAmount, anyValue);

            const afterBalance = await ethers.provider.getBalance(user1.address);
            // 注意：余额会增加，但由于gas费用，实际增加可能小于unstakeAmount
            console.log("afterBalance: ", ethers.formatEther(afterBalance));
            await expect(afterBalance).to.be.gt(beforeBalance);
            await expect(afterBalance).to.be.lt(beforeBalance + unstakeAmount);
        });
    });

    describe("领取奖励", function () {
        it("应该正确领取奖励", async function () {
            const { stake, admin, user1, rewardToken, startBlock, endBlock, rewardTokenPerBlock } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                true
            );

            // 质押ETH
            let depositBlockNumber = await ethers.provider.getBlockNumber();
            console.log("质押前区块号:", depositBlockNumber);
            const depositAmount = ethers.parseEther("1");
            await stake.connect(user1).depositETH({ value: depositAmount });

            // 推进区块以产生奖励
            for (let i = 0; i < 100; i++) {
                await ethers.provider.send("evm_mine", []);
            }

            // 领取奖励
            let claimBlockNumber = await ethers.provider.getBlockNumber();
            console.log("领取奖励前区块号:", claimBlockNumber);
            await expect(stake.connect(user1).claim(0))
                .to.emit(stake, "Claim")
                .withArgs(0, user1.address, anyValue);

            // 应该领取的奖励为：
            const result = ethers.toBigInt(Math.min(claimBlockNumber, endBlock) - Math.max(depositBlockNumber, startBlock)) * rewardTokenPerBlock
            console.log("result: ", result);

            const user = await stake.users(0, user1.address);
            // console.log("user.pendingRewardToken: ", await user.pendingRewardToken);
            // console.log("user.finishedRewardToken: ", await user.finishedRewardToken);
            expect(await user.pendingRewardToken).to.be.equal(ethers.parseEther("0"));
            expect(await user.finishedRewardToken).to.be.equal(result);
        });
    });

    describe("管理员功能", function () {
        it("应该能暂停和恢复质押", async function () {
            const { stake, admin } = await loadFixture(deployContractsFixture);

            await expect(stake.connect(admin).setpausedDeposit(true))
                .to.emit(stake, "SetpausedDeposit")
                .withArgs(true);

            await expect(stake.connect(admin).setpausedDeposit(false))
                .to.emit(stake, "SetpausedDeposit")
                .withArgs(false);
        });

        it("应该能更新奖励参数", async function () {
            const { stake, admin } = await loadFixture(deployContractsFixture);

            const newStartBlock = (await ethers.provider.getBlockNumber()) + 100;
            const newEndBlock = newStartBlock + 5000;
            const newRewardPerBlock = ethers.parseEther("2");

            await expect(stake.connect(admin).setStartBlock(newStartBlock))
                .to.emit(stake, "SetStartBlock")
                .withArgs(newStartBlock);

            expect(await stake.startBlock()).to.equal(newStartBlock);

            await expect(stake.connect(admin).setEndBlock(newEndBlock))
                .to.emit(stake, "SetEndBlock")
                .withArgs(newEndBlock);

            expect(await stake.endBlock()).to.equal(newEndBlock);

            await expect(stake.connect(admin).setRewardTokenPerBlock(newRewardPerBlock))
                .to.emit(stake, "SetRewardTokenPerBlock")
                .withArgs(newRewardPerBlock);

            expect(await stake.rewardTokenPerBlock()).to.equal(newRewardPerBlock);
        });
    });

    describe("查询功能", function () {
        it("应该正确查询池长度", async function () {
            const { stake, admin, stakingToken } = await loadFixture(deployContractsFixture);

            expect(await stake.poolLength()).to.equal(0);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            expect(await stake.poolLength()).to.equal(1);

            await stake.connect(admin).addPool(
                stakingToken.target,
                200,
                ethers.parseEther("10"),
                200,
                false
            );

            expect(await stake.poolLength()).to.equal(2);
        });

        it("应该正确查询用户质押余额", async function () {
            const { stake, admin, user1 } = await loadFixture(deployContractsFixture);

            await stake.connect(admin).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            const depositAmount = ethers.parseEther("1");
            await stake.connect(user1).depositETH({ value: depositAmount });

            const stakingBalance = await stake.stakingBalance(0, user1.address);
            expect(stakingBalance).to.equal(depositAmount);

            const depositAmount2 = ethers.parseEther("9");
            await stake.connect(user1).depositETH({ value: depositAmount2 });

            const stakingBalance2 = await stake.stakingBalance(0, user1.address);
            expect(stakingBalance2).to.equal(depositAmount2 + depositAmount);
        });
    });
});

// 辅助函数
function anyValue() {
    return true; // 用于匹配任何值
}