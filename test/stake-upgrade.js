const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time, loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("Stake upgrade", function () {
    let Stake, StakeV2;
    let stake, stakeV2;
    let owner, user1, user2;
    let rewardToken;
    let proxyAddress;
    let startBlock, endBlock;
    const rewardPerBlock = ethers.parseEther("1");
    const durationBlocks = 100000;

    // 部署初始合约的fixture
    async function deployStakeFixture() {
        [owner, user1, user2] = await ethers.getSigners();

        // 部署测试用的奖励代币
        const RewardToken = await ethers.getContractFactory("ERC20Mock");
        rewardToken = await RewardToken.deploy("Reward Token", "RWD", owner.address, ethers.parseEther("1000000"));
        await rewardToken.waitForDeployment();

        // 部署初始Stake合约
        Stake = await ethers.getContractFactory("Stake");

        startBlock = (await ethers.provider.getBlockNumber()) + 100;
        endBlock = startBlock + durationBlocks;

        const stakeProxy = await upgrades.deployProxy(
            Stake,
            [await rewardToken.getAddress(), startBlock, endBlock, rewardPerBlock],
            {
                initializer: "initialize",
                kind: "uups"
            }
        );

        await stakeProxy.waitForDeployment();
        proxyAddress = await stakeProxy.getAddress();

        stake = Stake.attach(proxyAddress);

        // 给owner授予管理员和升级权限
        const ADMIN_ROLE = await stake.ADMIN_ROLE();
        const UPGRADE_ROLE = await stake.UPGRADE_ROLE();

        await stake.grantRole(ADMIN_ROLE, owner.address);
        await stake.grantRole(UPGRADE_ROLE, owner.address);

        // 预存一些奖励代币到Stake合约
        await rewardToken.transfer(proxyAddress, ethers.parseEther("100000"));

        return { stake, rewardToken, owner, user1, user2, proxyAddress };
    }

    // 部署StakeV2合约的fixture
    async function deployStakeV2Fixture() {
        const { stake, rewardToken, owner, user1, user2, proxyAddress } = await loadFixture(deployStakeFixture);

        // 部署StakeV2合约
        StakeV2 = await ethers.getContractFactory("StakeV2");

        // 升级到V2
        const stakeProxyV2 = await upgrades.upgradeProxy(proxyAddress, StakeV2);
        await stakeProxyV2.waitForDeployment();

        stakeV2 = StakeV2.attach(proxyAddress);

        return { stake, stakeV2, rewardToken, owner, user1, user2, proxyAddress };
    }

    describe("基础升级测试", function () {
        it("应该正确部署初始合约", async function () {
            const { stake, rewardToken } = await loadFixture(deployStakeFixture);

            expect(await stake.RewardToken()).to.equal(await rewardToken.getAddress());
            expect(await stake.startBlock()).to.equal(startBlock);
            expect(await stake.endBlock()).to.equal(endBlock);
            expect(await stake.rewardTokenPerBlock()).to.equal(rewardPerBlock);
        });

        it("应该成功升级到V2版本", async function () {
            const oldImplAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

            const { stakeV2 } = await loadFixture(deployStakeV2Fixture);

            // 验证代理地址不变
            const currentProxyAddress = await stakeV2.getAddress();
            expect(currentProxyAddress).to.equal(proxyAddress);

            // 验证实现地址已更新
            const newImplAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

            expect(newImplAddress).to.not.equal(oldImplAddress);

            console.log("✅ 代理地址保持不变:", currentProxyAddress);
            console.log("✅ 实现地址已更新");
        });

        it("升级后状态变量应该保持不变", async function () {
            const { stake, stakeV2, rewardToken } = await loadFixture(deployStakeV2Fixture);

            // 验证核心状态变量
            expect(await stakeV2.RewardToken()).to.equal(await stake.RewardToken());
            expect(await stakeV2.startBlock()).to.equal(await stake.startBlock());
            expect(await stakeV2.endBlock()).to.equal(await stake.endBlock());
            expect(await stakeV2.rewardTokenPerBlock()).to.equal(await stake.rewardTokenPerBlock());

            console.log("✅ 所有状态变量保持不变");
        });

        it("应该保留原有的用户质押数据", async function () {
            const { stake, rewardToken, owner, user1 } = await loadFixture(deployStakeFixture);

            // 添加ETH池
            await stake.connect(owner).addPool(
                ethers.ZeroAddress,
                100,
                ethers.parseEther("0.1"),
                100,
                false
            );

            // 用户质押ETH
            const depositAmount = ethers.parseEther("1");
            await stake.connect(user1).depositETH({ value: depositAmount });

            // 验证质押数据
            const poolInfo = await stake.pools(await stake.ETH_PID());
            expect(poolInfo.stTokenAmount).to.equal(depositAmount);

            const userInfo = await stake.users(await stake.ETH_PID(), user1.address);
            expect(userInfo.stAmount).to.equal(depositAmount);

            // 升级合约
            StakeV2 = await ethers.getContractFactory("StakeV2");
            await upgrades.upgradeProxy(proxyAddress, StakeV2);
            const stakeV2 = StakeV2.attach(proxyAddress);

            // 验证升级后质押数据不变
            const poolInfoV2 = await stakeV2.pools(await stakeV2.ETH_PID());
            expect(poolInfoV2.stTokenAmount).to.equal(depositAmount);

            const userInfoV2 = await stakeV2.users(await stakeV2.ETH_PID(), user1.address);
            expect(userInfoV2.stAmount).to.equal(depositAmount);

            console.log("✅ 用户质押数据保持不变");
        });
    });
});

// 辅助函数
function anyValue() {
    return true; // 用于匹配任何值
}